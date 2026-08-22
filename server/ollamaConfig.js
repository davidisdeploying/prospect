// server/ollamaConfig.js — single source of truth for the Ollama endpoint and model names
// shared by the inference/enrichment workers (embed.js, enrich.js, llmParse.js, advise.js,
// skillExtract.js). H17: these three values were previously duplicated as bare literals
// across five modules — ten definitions in total — so changing the inference host or a model
// meant five separate edits with nothing to catch a missed one.
//
// Deliberately plain constants rather than env-var-backed: Prospect's inference host is fixed
// fleet infrastructure, and an override would add a silent misconfiguration path where a
// typo'd variable redirects inference with no error. Changing a value here is a reviewed
// source change, which is the intent.

export const OLLAMA_URL = 'http://charlie:11434';
export const LLM_MODEL = 'gpt-oss:20b';
export const EMBED_MODEL = 'nomic-embed-text';
