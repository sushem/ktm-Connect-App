# The two links

> **Correction, and where the dashboard link actually lives.** This document
> originally described only the Bluetooth Classic MY RIDE serial link, and
> concluded from a 390 Adventure's SDP record that a bike without that service
> could not be driven at all. That was wrong. Bikes from roughly 2020 on carry a
> **Gen-3 dashboard, which speaks a completely different protocol over BLE** —
> see [Gen-3: the BCCU BLE protocol](#gen-3-the-bccu-ble-protocol) below. The
> serial link covers the older dashboards only.


The app speaks to the motorcycle over two unrelated Bluetooth links. They use
different radios, different protocols, and have different platform support, so
it is worth being precise about which is which.

| | Bike → phone | Phone → bike |
|---|---|---|
| What it carries | engine data (rpm, speed, temperatures…) | text and turn-by-turn drawn on the TFT display |
| Radio | Bluetooth Low Energy | BLE on Gen-3; Bluetooth Classic (RFCOMM) on older dashboards |
| Hardware needed | BLE OBD-II adapter on the diagnostic port | nothing beyond the bike |
| Protocol | ELM327 command set over a BLE UART, carrying OBD-II | Gen-3: encrypted BCCU over GATT. Older: KTM's length-prefixed JSON over RFCOMM |
| Android | yes | yes |
| iOS | yes | Gen-3 yes; the older serial link **no** — see below |

## Why the older display link is Android-only

Opening a Bluetooth Classic serial port on iOS requires the External Accessory
framework, which only talks to accessories enrolled in Apple's MFi programme
and declaring a protocol string the app is entitled to use. The bike is not such
an accessory, so no third-party iOS app can open the MY RIDE socket. Core
Bluetooth, which iOS does expose, is BLE-only and the dashboard does not offer a
BLE service.

Neither the telemetry side nor a Gen-3 dashboard has that problem: both are
ordinary BLE, so on an iPhone everything works except the older serial link.

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
- **A plain Serial Port Profile (0x1101), or a vendor UUID that is not the one
  below.** Interesting: the dashboard may carry the same protocol on a
  different service. Connecting tries MY RIDE first and then every serial
  service the device advertises, in that order, and each one also has a **Try**
  button of its own.

Note that being on the bike's pairing screen is not the same as being paired.
The app only lists **bonded** devices, so the phone has to have finished pairing
in its own Bluetooth settings first.

### One real dashboard: a 390 Adventure

A 2020s 390 Adventure, paired as `KTM3237`, answered SDP with:

| UUID | Service |
|---|---|
| `0000110e` | A/V Remote Control |
| `0000111e` | Hands-Free |
| `00001124` | Human Interface Device |
| `00001101` | **Serial Port (SPP)** |
| `0000112e` | Phone Book Access Client |

No MY RIDE, which matches the manual listing it as an optional extra — but a
plain Serial Port Profile is there.

**That serial port accepts a connection.** The socket opens, frames can be
written to it, and the link stays up. What it does not do is act on them: the
display shows nothing, and the dashboard sends nothing back — not an error, not
a byte.

So SPP on this dashboard is a real serial port that is not the display channel,
or is one that ignores traffic until something else has happened. Without MY RIDE
activated there is no reason to expect the display service to be running at all,
and an open socket is not evidence that it is: RFCOMM will happily connect to a
service that then does nothing with what arrives.

Two switches exist for probing further, both on the Setup tab:

- **Send the opening frames on connect**, off, opens the link and only listens.
  Worth trying on an unfamiliar dashboard: it may be waiting to introduce
  itself, or may drop a peer that opens with something unrecognised.
- The **Codes** tab logs every inbound chunk as hex and ASCII before parsing,
  so anything the dashboard volunteers shows up even if it is not our framing.


## Gen-3: the BCCU BLE protocol

Dashboards from around 2020 on — the 390 Adventure among them — expose a BLE
GATT service instead of an RFCOMM one. This is what the KTMconnect app talks to,
and it is the path this app uses by default.

Everything below is implemented in `src/protocol/bccu/`. The UUIDs, payload
shapes and crypto come from the
[Navigator Gen3](https://github.com/Pavanayi1/KTM-Nav-GEN3) project (MIT), which
documents them as confirmed byte-exact against two independent implementations
of the same protocol.

### GATT layout

All under the base `71ced1ac-XXXX-44f5-9454-806ff70b3e02`:

| Short | Characteristic | Purpose |
|---|---|---|
| `0700` | main service | everything below hangs off it |
| `0701` | auth request | indications from the bike: nonce and handshake commands |
| `0702` | auth reply | our half of the handshake |
| `0703` | navigation state | `[flags][volume]`; bit 0 guidance, bit 1 GPS icon |
| `0704` | turn icon | `[visibility][icon code]` |
| `0705` | turn distance | `[visibility][text]`, 8 chars |
| `0706` | turn info | 16 chars |
| `0707` | turn road | 32 chars |
| `0708` | ETA | 8 chars |
| `0709` | remaining distance | 8 chars |
| `070a` | notification | `[visibility][icon][text]`, 16 chars |

Two things catch you out. **Visibility is not a boolean** — it is `1` off, `2`
half, `3` full. And **the dashboard renders nothing until guidance is on**, so
`0703` has to be written before any of the display fields do anything.

### The handshake

The bike drives it; the phone answers.

1. On subscribing to `0701`, the bike sends a 16-byte nonce `m1` in the clear.
2. We answer on `0702` with our own nonce `m2`. Both sides interleave the two
   halves into a temporary IV and secret; every later control message is
   AES-CBC under those.
3. The bike sends `HELLO`. We echo it back — and only that. Whether the
   dashboard shows its "confirm this device" prompt is its own decision, made
   from its bond memory, so answering anything cleverer just stalls.
4. **First pairing:** the bike sends `GENERATE_KEYS` carrying a challenge. Both
   sides mirror its tail, concatenate the four cyclic rotations of
   (challenge, mirrored, IV, secret), SHA-512 each one, and cut the digests into
   **sixteen 16-byte session keys**.
5. The bike names one by index, we acknowledge, and the session is up.

**Reconnects skip steps 4 entirely.** The bike keeps the key pool across
ignition cycles and simply names an index, so the phone has to have persisted
its copy — otherwise every reconnect stalls with nothing to select from, and the
rider gets asked to confirm the pairing all over again. We store it per device
id (`src/state/keyStore.ts`).

The command byte sits in **byte 2** of a message from the bike, but in **byte 4**
of ours, which puts a `0xFF` marker in byte 2 instead. The asymmetry is real;
mixing the two up produces a handshake that stalls after the first exchange.

### Two encryption modes

- **Control** (the handshake) is a single raw AES-CBC block, no wrapper.
- **Data** (anything drawn on the display) is framed first — 16 random bytes,
  the payload, random filler, and the pad length in the last byte — and then
  encrypted. `frame()` always rounds up to whole blocks.

The implementation is verified against the reference algorithms run through the
JDK: `src/protocol/bccu/__tests__/crypto.test.ts` asserts byte-exact AES output,
nonce interleaving, challenge mirroring and all sixteen derived keys.

### Finding the bike

Scanning alone is not enough, and this is the trap that makes a working
implementation look broken: **a dashboard already connected over Bluetooth
Classic for music and calls frequently stops advertising over BLE**. It is
sitting right there, paired, and no BLE scan will see it.

So the device list is built from two sources: the phone's bonded devices first
(their address is all a BLE connection needs), then whatever is advertising.
Nothing is filtered out — a dashboard often advertises with no name and without
declaring its services, so filtering on either hides exactly the device you are
looking for. Likely candidates are marked and sorted up instead.

Bonded devices are Android-only; iOS does not expose the bond list to apps, so
there the bike has to be advertising to be found.

### Why this one works on iOS

It is ordinary BLE, and Core Bluetooth is open to any app. Only the older
serial link runs into the MFi restriction, so on an iPhone a Gen-3 bike can be
driven from this app while an older one cannot.

## Phone → bike: the older MY RIDE serial link

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
