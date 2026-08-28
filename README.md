# KTM Connect

A React Native app for KTM motorcycles that does two things:

- **Reads the bike and shows it on the phone.** Engine speed, road speed,
  estimated gear, coolant / oil / intake temperatures, throttle, load, battery
  voltage, fuel level and stored trouble codes, through a Bluetooth LE OBD-II
  adapter on the bike's diagnostic port. Android and iOS.
- **Writes to the bike's TFT display.** Messages and turn-by-turn guidance over
  the MY RIDE Bluetooth Classic link, plus an option to mirror speed and gear
  onto the dash while riding. Android only — [iOS does not let third-party apps
  open a Bluetooth Classic serial port](docs/KTM-PROTOCOL.md#why-the-display-link-is-android-only).

Not affiliated with or endorsed by KTM. The display protocol comes from
community reverse engineering, not a published specification — see
[docs/KTM-PROTOCOL.md](docs/KTM-PROTOCOL.md).

## Screens

| Tab | What it does |
|---|---|
| **Ride** | Tachometer with the speed and gear in the middle, tiles for the rest, and running distance / top speed / peak rpm for the session |
| **Connect** | Scan and connect each link independently; demo mode lives here too |
| **Display** | Send a message or a turn instruction to the bike, mirror live data, hand the screen back |
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
npm test          # 75 unit and integration tests
npm run typecheck
npm run lint
```

The JavaScript side is verified here. The Android native module and the iOS
project have **not** been compiled in this environment — no Android SDK or Xcode
— so treat the first `npm run android` / `npm run ios` as the real build check.

## How it is put together

```
specs/NativeKtmLink.ts        TurboModule spec for the RFCOMM link
android/…/ktmlink/            its Kotlin implementation (socket + reader thread)
src/
  transport/                  Transport interface, BLE, MY RIDE, demo
  protocol/obd/               ELM327 conversation, PID table, poll loop
  protocol/ktm/               MY RIDE framing and message bodies
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
