# Relive CRM phone app (Android and iPhone)

One app for both phones, built with Expo. It talks to the same database as the web CRM, so row level security decides what each person sees.

| | Android | iPhone |
|---|---|---|
| Today queue (first calls, overdue, due today), leads, search | yes | yes |
| Tap to call, WhatsApp templates, stage, follow-up, notes, tasks | yes | yes |
| Calls logged automatically from the phone's call log | yes | no (Apple does not allow any app to read calls) |
| Call recordings saved by the phone's own dialer, uploaded to the lead | yes, if the phone records calls | no |
| "How did the call go?" screen after every call | yes, pre-filled from the call log | yes, agent confirms |
| Attendance check-in and check-out with GPS | yes | yes |
| Push notifications: new lead, lead passed to you, reminders | yes | yes |
| Background call sync | about every 15 minutes, plus every time the app opens | not needed |

## Try it on your phone today (no build, no accounts)

Expo Go runs the app without building it. Automatic call logging is the one thing missing in Expo Go, because it needs the app's own Android code.

1. Install **Expo Go** from the Play Store or App Store.
2. On the Mac, start the CRM so phones on the same Wi-Fi can reach it:
   `cd local && sh start.sh --lan` (it prints the server address, for example `http://192.168.1.20:54321`).
3. In a second Terminal: `cd mobile && npm install && npx expo start`
4. Scan the QR code with the phone camera (iPhone) or Expo Go (Android).
5. On the sign-in screen, tap **Server settings**, enter the address from step 2, then sign in with a demo login (`priya@relive.test` / `demo1234`).

## Install the full Android app (with automatic call logging)

The Android app is installed directly as an APK, not through the Play Store. Google only lets dialer apps read the call log, so a CRM that does this has to be installed outside the store, as Cratio's and similar apps are.

- A ready APK built from this code is included next to this folder as `relive-crm-android.apk`. Copy it to the phone, open it, and allow "install unknown apps" once.
- To build it yourself in the cloud: `npx eas-cli@latest login`, `npx eas-cli@latest init`, then `npm run build:android:apk`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `eas.json` first, so the app points at the live server.

On first open, go to **Me** and tap **Allow call log access**. Allow audio files too if you want recordings.

## Updates (no more sending APK files)

The Android app updates itself. To ship a new version:

1. Bump `version` and `android.versionCode` in `app.json` (the code must go up by at least 1).
2. Build the release APK, signed with the Relive key (see below). Name it `relive-crm-VERSION-CODE.apk`, for example `relive-crm-1.2.0-3.apk`.
3. In the web CRM go to **Admin → Phone app**, pick the file, add "What's new", and press **Upload and publish**.

Every phone checks when the app opens or comes back to the front. If a newer version is published it shows **Update available**, downloads it, and opens Android's Install screen. The person taps Install once; their sign-in and data stay. Tick **Must install** for a required update (no "Later" button). **Withdraw** a bad build and phones are offered the previous one instead. New staff download the current version from `/download/android` (also linked on the page shown after they set their password).

Android never lets an app installed outside the Play Store update without that one Install tap.

## Signing key (keep it safe)

Release builds are signed with the private Relive key, not React Native's public debug key. `plugins/with-relive-signing.js` reads `keystore.properties` from `RELIVE_KEYSTORE_PROPS` (default `/home/claude/relive-signing/keystore.properties`) and refuses to build a release without it. The key is **not** in git. Backup on the Mac: `Documents/CRM Re-Design/relive-android-signing/`. If the key is lost, no update can install over the existing app, and every phone has to uninstall and reinstall.

The very first APK (1.0.0, October 2026) was signed with the public debug key. Anyone who installed it must uninstall it once and install 1.1.0 or later.

## iPhone

iPhones need an Apple Developer account (USD 99 a year) to install an app outside Expo Go.
With the account: `npx eas-cli@latest build --platform ios --profile preview` and install it with the link EAS gives, or ship through TestFlight.

## Push notifications

Push needs the app linked to an Expo project: run `npx eas-cli@latest init` once in this folder (free Expo account). The CRM server then sends notifications through Expo's push service. Without it, everything else works and alerts still appear in the web bell.

## For developers

- Screens live in `src/app` (Expo Router). Shared code is in `src/lib` and `src/components`.
- `modules/call-log-sync` is the Android-only native module (Kotlin) that reads the call log and finds recordings.
- `android/` and `ios/` are generated by `npx expo prebuild`; do not edit them by hand.
- Checks: `npm run typecheck` and `npx expo-doctor`.
