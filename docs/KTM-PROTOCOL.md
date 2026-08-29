# The two links

The app speaks to the motorcycle over two unrelated Bluetooth links. They use
different radios, different protocols, and have different platform support, so
it is worth being precise about which is which.

| | Bike → phone | Phone → bike |
|---|---|---|
| What it carries | engine data (rpm, speed, temperatures…) | text and turn-by-turn drawn on the TFT display |
| Radio | Bluetooth Low Energy | Bluetooth Classic (RFCOMM) |
| Hardware needed | BLE OBD-II adapter on the diagnostic port | nothing beyond a bike with MY RIDE |
| Protocol | ELM327 command set over a BLE UART, carrying OBD-II | KTM's own length-prefixed JSON |
| Android | yes | yes |
| iOS | yes | **no** — see below |

## Why the display link is Android-only

Opening a Bluetooth Classic serial port on iOS requires the External Accessory
framework, which only talks to accessories enrolled in Apple's MFi programme
and declaring a protocol string the app is entitled to use. The bike is not such
an accessory, so no third-party iOS app can open the MY RIDE socket. Core
Bluetooth, which iOS does expose, is BLE-only and the dashboard does not offer a
BLE service.

The telemetry side has no such problem: BLE OBD-II adapters are ordinary BLE
peripherals, and the Ride, Diagnostics and Settings screens work identically on
both platforms.

## Bike → phone: OBD-II over a BLE adapter

KTM's EFI bikes answer standard OBD-II requests on their diagnostic connector —
a 6-pin round plug on most models, so a 6-pin-to-OBD-II lead is needed between
the bike and an off-the-shelf adapter. Which parameters come back varies by
model and year; the app asks the ECU what it supports (PIDs `0100`, `0120`,
`0140`) and polls only those, dropping any that fail twice.

Cheap BLE adapters expose a UART-like pair of characteristics rather than a
standard service, and they do not agree on the UUIDs. `BleTransport` tries the
profiles that cover most of the market and then falls back to any service that
has both a writable and a notifying characteristic:

| Profile | Service | Write | Notify |
|---|---|---|---|
| Vgate / Viecar / most clones | `FFF0` | `FFF2` | `FFF1` |
| HM-10 style | `FFE0` | `FFE1` | `FFE1` |
| LeLink | `18F0` | `2AF1` | `2AF0` |
| Nordic UART | `6E400001-…` | `6E400002-…` | `6E400003-…` |

Above the transport it is a plain ELM327 conversation: `ATZ`, `ATE0`, `ATL0`,
`ATS0`, `ATH0`, `ATSP0`, then `01<pid>` requests, each answered with a line of
hex and a `>` prompt. `src/protocol/obd/` holds the parsing and the PID table.

Gear is not an OBD-II parameter. The app derives it from the ratio between
engine speed and road speed, matched against a per-bike table
(`src/utils/gear.ts`).

## Is MY RIDE even on this bike?

Worth settling before debugging a connection. KTM MY RIDE is not standard
equipment across the range: the 390 Adventure owner's manual lists MY RIDE,
Pairing, Phone, Headset, Telephony and Bluetooth as **optional**, and KTM's own
documentation says the function "must be activated by an authorised KTM dealer".
On several models it is a paid unlock rather than a menu item you can switch on.

A dashboard without that activation runs no MY RIDE service at all. The socket
then fails with Android's catch-all:

```
read failed, socket might closed or timeout, read ret: -1
```

which is the same error you get for a device that is not bonded, or one that is
busy — so the message alone proves nothing.

The app answers it directly instead. **Connect → the MY RIDE card → "What does
this device offer?"** runs an SDP query (`fetchUuidsWithSdp`) against the paired
device and lists the services it advertises. Three outcomes:

- **MY RIDE is listed.** The dashboard is ready; a failure to connect is
  something else — most often the bike being paired to another phone, or the
  ignition being off.
- **Only audio and phone profiles** (Hands-Free, A2DP, AVRCP, Phone Book).
  That is a dashboard whose Bluetooth works for music and calls but has no
  MY RIDE. A dealer activation is what unlocks it; nothing in software gets
  around that.
- **A vendor UUID that is not the one below.** Interesting: a newer dashboard
  may have moved the service. The app offers a **Try** button on any vendor
  UUID and on the Serial Port Profile, so it can be pointed at a different one
  without a rebuild.

Note that being on the bike's pairing screen is not the same as being paired.
The app only lists **bonded** devices, so the phone has to have finished pairing
in its own Bluetooth settings first.

## Phone → bike: the MY RIDE link

The dashboard registers an RFCOMM service under the vendor UUID:

```
cc4c1fb3-482e-4389-bdeb-57b7aac889ae
```

The bike has to be bonded through the phone's Bluetooth settings first (with
MY RIDE enabled in the bike's menu); it is not discoverable from within the app.
The socket is opened **insecure** — `createInsecureRfcommSocketToServiceRecord`.

Every message on the socket is framed as:

```
+--------+--------+--------+--------+--------+============+
|          length (uint32, big endian)      |  type  |  payload   |
+--------+--------+--------+--------+--------+============+
```

`length` counts the type byte plus the payload — that is, `payload length + 1`.
`type` is `0x01` for the UTF-8 JSON messages the display understands.

The payload looks like this:

```json
{
  "UiContext": "guidance",
  "UpdateUI": {
    "TurnRoad":         {"Text": "B320", "Visibility": "full"},
    "TurnDist":         {"Text": "350", "Visibility": "full"},
    "TurnDistUnit":     {"Text": "m", "Visibility": "full"},
    "TurnIcon":         {"Image": "QUITE_RIGHT", "Visibility": "full"},
    "GpsIcon":          {"Image": "GPS", "Visibility": "full"},
    "Dist2Target":      {"Text": "42 km", "Visibility": "full"},
    "ETA":              {"Text": "14:35", "Visibility": "full"},
    "TurnInfo":         {"Text": "", "Visibility": "off"},
    "NotificationText": {"Text": "", "Visibility": "off"},
    "NotificationIcon": {"Visibility": "off"}
  },
  "MsgId": "gon#7"
}
```

Points worth knowing:

- **Hiding a field means sending it with `"Visibility": "off"`**, not omitting
  it. Text fields carry `Text`, icon fields carry `Image`.
- **`MsgId` is a prefix plus an incrementing counter.** `gon#n` in the
  `guidance` context, `Restore#n` in the `default` one. The counter has to keep
  rising or the display ignores the update.
- **`UiContext` switches the layout**: `guidance` is the navigation screen,
  `default` hands the screen back to the bike with a notification line
  available.
- **The display is a renderer, not a navigator.** It draws exactly what you
  send and keeps drawing it until the next message, so the phone owns all the
  logic.
- `TurnIcon` takes one of a fixed set of names (`GO_STRAIGHT`, `KEEP_LEFT`,
  `RAB_SECT_8_RH`, `FERRY`, `END`, …) — the full list is in
  `src/protocol/ktm/messages.ts`.

### Provenance and caveats

KTM publishes no specification for this link. The framing and field names here
come from community reverse engineering — chiefly the
[Connected-to-my-KTM](https://github.com/pinginfo/Connected-to-my-ktm) project
and the ADVrider thread it cites — and were confirmed against a 790 Adventure.
Newer "Gen 3" dashboards and the KTMconnect app may differ; if the display
ignores what you send, the framing is the first thing to check, with the
message-id counter second. The reference work was done on a 790 Adventure, a
model where MY RIDE is present; smaller bikes in the range may not carry the
service at all, as above.

Nothing here bypasses a protection mechanism or unlocks a paid feature: it is
the same public serial service the official app uses, addressed by an app you
chose to install.
