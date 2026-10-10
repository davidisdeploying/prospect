import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendApplicationPackageEvent, applicationPackageReadiness, getApplicationPackage, prepareApplicationPackage,
  registerApplicationPackageArtifact, ApplicationPackageError,
} from './applicationPackages.js';
import { createJobAuditForDatabase } from './jobAudit.js';
import {
  failOrRetryGenerationJob, leaseNextGenerationJob, renewGenerationJobLease, updateGenerationJob,
} from './applicationGenerationQueue.js';
import {
  applicationPackageArtifactDirectory, inspectApplicationPackageRender, PackageDraftValidationError,
  renderApplicationPackage,
} from './applicationPackageRenderer.js';
import { TowerPackageProvider } from './towerPackageProvider.js';
import { listingSnapshotHash } from './listingSnapshot.js';
import { leaseNextInterviewResearchJob } from './interviewResearchQueue.js';
import { processInterviewResearchJob } from './interviewResearchWorker.js';

const DEFAULT_STAGING_ROOT = '/home/david/prospect/data/application-generation';
const DEFAULT_ARTIFACT_ROOT = '/home/david/Vaults/career-vault/files';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unchangedSource(database, job) {
  const listing = database.prepare('SELECT * FROM listings WHERE id=?').get(job.listing_id);
  return listing && Number(listing.snapshot_generation || 1) === Number(job.listing_snapshot_generation)
    && listingSnapshotHash(listing) === String(job.listing_snapshot_hash || '');
}

function startLeaseHeartbeat(database, jobId, owner, { leaseSeconds, heartbeatMs }) {
  let failure = null;
  const renew = () => {
    if (failure) return;
    try { renewGenerationJobLease(database, jobId, owner, { leaseSeconds }); }
    catch (error) { failure = error; }
  };
  renew();
  if (failure) throw failure;
  const timer = setInterval(renew, heartbeatMs);
  timer.unref?.();
  return {
    assertOwned() { if (failure) throw failure; },
    stop() { clearInterval(timer); },
  };
}

export async function processGenerationJob(database, job, {
  owner, provider = new TowerPackageProvider(), stagingRoot = process.env.PROSPECT_PACKAGE_STAGING_ROOT || DEFAULT_STAGING_ROOT,
  artifactRoot = process.env.CAREER_ARTIFACT_ROOT || DEFAULT_ARTIFACT_ROOT, now = new Date(),
  leaseSeconds = 300, leaseHeartbeatMs = Math.max(1000, Math.floor(leaseSeconds * 1000 / 3)),
} = {}) {
  if (!owner) throw new Error('worker owner is required');
  const heartbeat = startLeaseHeartbeat(database, job.id, owner, {
    leaseSeconds, heartbeatMs: Math.max(1, Number(leaseHeartbeatMs) || 1000),
  });
  try {
    if (!unchangedSource(database, job)) {
      return updateGenerationJob(database, job.id, owner, 'needs_review', { error: 'Listing snapshot changed after this request; regenerate from the current claim.' });
    }
    if (!job.baseline_resume_version_id) {
      return updateGenerationJob(database, job.id, owner, 'needs_review', { error: 'Select an audited baseline resume, then regenerate.' });
    }
    createJobAuditForDatabase(database, {
      listingId: job.listing_id, claimId: job.claim_id,
      resumeVersionId: job.baseline_resume_version_id, requestSynthesis: false,
    });
    const readiness = applicationPackageReadiness(database, job.claim_id, job.baseline_resume_version_id);
    if (!readiness.ready) {
      const missing = Object.entries(readiness.checks).filter(([, value]) => !value.ready).map(([name]) => name).join(', ');
      return updateGenerationJob(database, job.id, owner, 'needs_review', { error: `Current inputs are missing or stale: ${missing}. Resolve them and regenerate.` });
    }
    const packageRow = job.package_id
      ? getApplicationPackage(database, job.package_id)
      : prepareApplicationPackage(database, job.claim_id, job.baseline_resume_version_id);
    updateGenerationJob(database, job.id, owner, 'drafting', { packageId: packageRow.id });

    const stageDir = path.join(path.resolve(stagingRoot), `job-${job.id}`);
    fs.mkdirSync(stageDir, { recursive: true });
    const stagingPath = path.join(stageDir, 'draft.json');
    let providerResult;
    const refreshed = database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(job.id);
    if (fs.existsSync(stagingPath) && refreshed.response_token_match === 1) {
      providerResult = {
        token: refreshed.run_token, provider: refreshed.provider, model: refreshed.model,
        responseTokenMatch: refreshed.response_token_match === 1,
        draft: JSON.parse(fs.readFileSync(stagingPath, 'utf8')),
      };
      if (!providerResult.token || !providerResult.responseTokenMatch) throw new Error('staged draft lacks verified Tower token metadata; refusing to refire');
    } else if (refreshed.run_token && typeof provider.resume === 'function') {
      providerResult = await provider.resume({ token: refreshed.run_token, stagingPath });
    } else if (refreshed.run_token) {
      return updateGenerationJob(database, job.id, owner, 'needs_review', { error: 'Prior provider token exists but cannot be resumed safely; manual review is required before regeneration.' });
    } else {
      providerResult = await provider.draft({
        job: refreshed, packageRow, stagingPath,
        onToken: (metadata) => updateGenerationJob(database, job.id, owner, 'drafting', {
          packageId: packageRow.id, runToken: metadata.token, provider: metadata.provider,
          model: metadata.model, stagingPath,
        }),
      });
    }
    heartbeat.assertOwned();
    if (providerResult.responseTokenMatch !== true) throw new Error('draft provider did not prove response_token_match');
    updateGenerationJob(database, job.id, owner, 'rendering', {
      packageId: packageRow.id, provider: providerResult.provider, model: providerResult.model,
      runToken: providerResult.token, stagingPath, responseTokenMatch: true,
    });
    const renderMetadata = { provider: providerResult.provider, model: providerResult.model, runToken: providerResult.token, responseTokenMatch: true };
    const renderOptions = { packageRow, artifactRoot, now, metadata: renderMetadata };
    const outputDirectory = applicationPackageArtifactDirectory(artifactRoot, packageRow.id, now);
    const rendered = fs.existsSync(outputDirectory)
      ? inspectApplicationPackageRender(renderOptions)
      : await renderApplicationPackage({ ...renderOptions, draft: providerResult.draft });
    const registered = database.transaction(() => rendered.files.map((file) => {
      const existing = database.prepare('SELECT * FROM application_package_artifacts WHERE package_id=? AND path=?').get(packageRow.id, file.path);
      if (existing) {
        const expectedKind = file.name.startsWith('resume.') ? 'resume' : 'cover_letter';
        const expectedFormat = path.extname(file.name).slice(1);
        if (existing.kind !== expectedKind || existing.format !== expectedFormat || existing.sha256 !== file.sha256) throw new Error(`existing artifact registration drift: ${file.name}`);
        return existing;
      }
      return registerApplicationPackageArtifact(database, packageRow.id, {
        kind: file.name.startsWith('resume.') ? 'resume' : 'cover_letter',
        format: path.extname(file.name).slice(1), path: file.path,
      });
    }))();
    if (registered.length !== 4 || registered.some((artifact) => rendered.hashes[path.basename(artifact.path)] !== artifact.sha256)) {
      throw new Error('registered artifact verification failed');
    }
    return updateGenerationJob(database, job.id, owner, 'ready', { packageId: packageRow.id });
  } catch (error) {
    if (error instanceof ApplicationPackageError && error.status === 409) {
      return updateGenerationJob(database, job.id, owner, 'needs_review', { error: error.message });
    }
    if (error instanceof PackageDraftValidationError) {
      return updateGenerationJob(database, job.id, owner, 'needs_review', {
        error: `Generated draft failed the grounding contract: ${error.message}. Regenerate after reviewing the package evidence.`,
      });
    }
    const current = database.prepare('SELECT * FROM application_generation_jobs WHERE id=?').get(job.id);
    if (error?.retryWithFreshToken === true) {
      return database.transaction(() => {
        if (current.package_id) {
          appendApplicationPackageEvent(database, current.package_id, 'generation_failed', {
            run_token: error.runToken || current.run_token,
            phase: error.providerPhase || 'unknown',
            error: String(error.message || error).slice(0, 2000),
          });
        }
        return failOrRetryGenerationJob(database, current, owner, error, { resetProviderAttempt: true });
      })();
    }
    return failOrRetryGenerationJob(database, current, owner, error);
  } finally {
    heartbeat.stop();
  }
}

export async function runPackageWorker(database, {
  once = false, idleMs = 5000, owner = `${os.hostname()}:${process.pid}`,
  provider, stagingRoot, artifactRoot, researchProvider, researchStagingRoot,
} = {}) {
  do {
    const job = leaseNextGenerationJob(database, owner);
    if (job) await processGenerationJob(database, job, { owner, provider, stagingRoot, artifactRoot });
    const researchJob = job ? null : leaseNextInterviewResearchJob(database, owner);
    if (researchJob) await processInterviewResearchJob(database, researchJob, {
      owner, provider: researchProvider, stagingRoot: researchStagingRoot,
    });
    else if (!job && !once) await sleep(idleMs);
    if (once) return job || researchJob;
  } while (true);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { db } = await import('./db.js');
  await runPackageWorker(db);
}
