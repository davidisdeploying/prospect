# Prospect for Safari

Native iOS/iPadOS and macOS containers for the canonical WebExtension in
`../../../extension`.

- App ID: `cc.davidgomez.prospect.safari`
- Extension ID: `cc.davidgomez.prospect.safari.Extension`
- The same pair is used on iOS/iPadOS and macOS.
- `Shared (Extension)/Resources` is a relative symlink to the repository's
  canonical `extension/` directory. Do not copy or fork those resources.

The wrapper adds no credentials, Cloudflare service token, background crawl,
or alternate ingress. Capture remains user initiated, reviewed, and explicitly
confirmed through the existing tailnet origins.

## Transport gate

The canonical extension defaults to the HTTPS tailnet origin on port 8443 and
retains the HTTP origin on port 8787 for compatibility. Source tests and
unsigned builds can prove both origins are packaged. A separately approved
physical-device run must prove Safari can request and post through the intended
origin before this wrapper is considered installable. If HTTP is rejected, stop
and report; do not weaken Prospect ingress or add a service token.

Build without signing:

```sh
xcodebuild -project 'apple/Prospect for Safari/Prospect for Safari.xcodeproj' \
  -scheme 'Prospect for Safari (iOS)' -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -project 'apple/Prospect for Safari/Prospect for Safari.xcodeproj' \
  -scheme 'Prospect for Safari (macOS)' -sdk macosx \
  CODE_SIGNING_ALLOWED=NO build
```
