# Prospect iOS PWA Operator Notes (H20)

## Installation & Authentication
- **Installation Procedure**: Open the production HTTPS URL (`https://prospect.example.com`) in Safari on iOS after authenticating through Cloudflare Access. Tap the Safari **Share** icon and select **Add to Home Screen**.
- **Cookie Isolation & Inheritance**: iOS 17.2+ automatically copies active authentication cookies from Safari into the newly installed Standalone Web Application sandbox upon creation.
- **Session Expiry**: When the Cloudflare Access session expires, the standalone application may require re-authentication via Safari.

## Cloudflare Access Policy & Worker Update Troubleshooting
- All application HTML, API routes (`/api/*`), and job data remain strictly protected behind Cloudflare Access authentication.
- No Cloudflare Access bypass rules have been changed or applied.
- **Exemption Candidate Notice**: If live device testing proves Service Worker or manifest update checks fail due to authentication challenges on static assets, the ONLY candidate bypass list is static `/manifest.webmanifest`, `/sw.js`, `/pwa-register.js`, `/offline.html`, `/icon-192.png`, `/icon-512.png`, and `/apple-touch-icon.png`.
- **CRITICAL**: Application HTML (`/`, `/scout`, `/report`, `/claim-office`) and API endpoints (`/api/*`) must NEVER be exempted. Any potential Cloudflare policy adjustment for static assets requires separate, explicit approval prior to modification.
