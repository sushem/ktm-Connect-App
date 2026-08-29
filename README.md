# KTM Connect

A React Native app for KTM motorcycles that does two things:

- **Reads the bike and shows it on the phone.** Engine speed, road speed,
  estimated gear, coolant / oil / intake temperatures, throttle, load, battery
  voltage, fuel level and stored trouble codes, through a Bluetooth LE OBD-II
  adapter on the bike's diagnostic port. Android and iOS.
- **Writes to the bike's TFT display.** Messages and turn-by-turn guidance, plus
  an option to mirror speed and gear onto the dash while riding. Two protocols,
  picked on the Setup tab:
  - **Gen-3** (roughly 2020 on, including the 390 Adventure) — encrypted BLE.
    Works on Android and iOS.
  - **Older MY RIDE** — a Bluetooth Classic serial link, [Android
    only](docs/KTM-PROTOCOL.md#why-the-older-display-link-is-android-only).

Not affiliated with or endorsed by KTM. Neither display protocol is published
by KTM; both come from community reverse engineering — see
[docs/KTM-PROTOCOL.md](docs/KTM-PROTOCOL.md). The Gen-3 GATT layout, payload
shapes and crypto are taken from the
[Navigator Gen3](https://github.com/Pavanayi1/KTM-Nav-GEN3) project (MIT), with
thanks.

## Screens

| Tab | What it does |
|---|---|
| **Ride** | Tachometer with the speed and gear in the middle, tiles for the rest, and running distance / top speed / peak rpm for the session |
| **Connect** | Scan and connect each link independently; demo mode lives here too |
| **Message** | Type a line, hit send, and it appears on the bike's TFT screen — with quick presets, a list of what you sent before, and one tap to hand the screen back |
| **Nav** | Turn-by-turn instructions on the bike's display, and mirroring of live speed and gear |
| **Codes** | Read stored trouble codes, and watch the raw conversation on both links |
| **Setup** | Units, gearing profile for the gear estimate, poll rate |

## Demo mode

There is a full simulator built in: a fake ELM327 wired to a fake bike riding a
90-second lap, and a fake dashboard that reports what it was told to draw. Turn
on **Demo mode** on the Connect tab and every screen works with no hardware at
all. The simulator is a `Transport` like any other, so the protocol code, the
stores and the UI all run exactly as they do against a real bike — which is also
how much of the test suite exercises them.

## Getting started

```bash
npm install
npm start                 # Metro

npm run android           # Android device or emulator
npm run pods && npm run ios   # iOS (CocoaPods first)
```

Requirements: Node 22+, and the usual
[React Native environment](https://reactnative.dev/docs/environment-setup) for
whichever platform you are building.

### On the bike

1. Plug a BLE OBD-II adapter into the diagnostic connector. On most KTMs that is
   a 6-pin round plug, so you need a 6-pin-to-OBD-II lead.
2. Turn the ignition on — the ECU only answers when it is awake.
3. **Connect → Scan for adapters**, and pick yours. Names that look like an OBD
   adapter are marked ★.
4. For the display link: pair the bike in the phone's Bluetooth settings and
   enable MY RIDE in the bike's menu, then **Connect → List paired devices**.

The first connection asks the ECU which parameters it supports; anything it
refuses is dropped from the poll loop, so the set of tiles that light up varies
by model and year.

## Checks

```bash
npm test          # 140 unit and integration tests
npm run typecheck
npm run lint
```

## CI

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | every pull request | typecheck, lint, tests, then `assembleRelease` — which is what proves the native module and its codegen spec still agree — and uploads `KtmConnect.apk` as a build artifact (kept 14 days) |
| `.github/workflows/ci.yml` | every push to `main` | all of the above, and publishes the APK as a GitHub release tagged `main-<run number>` |
| `.github/workflows/build-apk.yml` | manual (**Actions → Build APK → Run workflow**) | builds a debug APK, a release APK or both, uploads them as artifacts, and publishes a GitHub release tagged `build-<run number>` |

So every merge to `main` leaves an installable build under
[Releases](../../releases) with no one having to press anything, and
`build-apk.yml` stays for cutting one on demand from any commit. The two use
different tag prefixes because each workflow counts its own run numbers.

To install a build from a pull request instead, open its CI run and download
**KtmConnect-apk** from the Artifacts section at the bottom of the summary page.

CI builds the *release* variant deliberately. A debug APK leaves the JavaScript
out and fetches it from Metro when it starts, so installing one on a phone with
no `npm start` running gives a red "Unable to load script" screen. Debug builds
are for `npm run android` during development, where Metro is there to serve
them.

Releases are marked as pre-releases, because the APK is signed with React
Native's debug keystore: it installs and runs, but is not fit to publish.
Generate a real keystore and wire it into `android/app/build.gradle` before
distributing anything.

There is no iOS workflow yet — that comes once the Android side has proven
itself, since a macOS runner costs about ten times as much per minute.

## How it is put together

```
specs/NativeKtmLink.ts        TurboModule spec for the RFCOMM link
android/…/ktmlink/            its Kotlin implementation (socket + reader thread)
src/
  transport/                  Transport interface, BLE, MY RIDE, demo
  protocol/obd/               ELM327 conversation, PID table, poll loop
  protocol/bccu/              Gen-3: GATT map, crypto, payloads, handshake
  protocol/ktm/               older MY RIDE framing and message bodies
  services/BikeService.ts     owns the radios, keeps the stores in step
  state/                      zustand stores (session, settings)
  screens/, components/       the UI
```

Both links sit behind one `Transport` interface — connect, write, listen — so
the protocol code above never knows which radio it is on, and the simulator can
stand in for either.

`react-native-bluetooth-classic` and similar libraries hardcode the Serial Port
Profile UUID, while MY RIDE registers under a vendor UUID, so the RFCOMM socket
is opened by a small native module in this repo rather than a dependency.

## Safety

Riding is not the time to read a phone. The Ride screen is built to be glanced
at on a bar mount, and the mirroring feature exists so the important numbers can
live on the bike's own display instead — but set everything up before you move,
and pull over to change it.
