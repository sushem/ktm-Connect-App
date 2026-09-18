# Audit against the Navigator Gen3 reference

Written after reading [Navigator Gen3](https://github.com/Pavanayi1/KTM-Nav-GEN3)
(MIT) end to end rather than a symptom at a time — the earlier approach, which
kept finding the next problem only after hitting it on the bike.

The reference is a mature Android app with real field experience. Much of what
looks like defensive scaffolding in it is load-bearing: its comments cite field
logs and dated reports for specific timings. Anything below marked **adopted**
was missing here and cost us a debugging round on the bike.

## Connection and handshake

| What the reference does | Here |
|---|---|
| `connectGatt(..., TRANSPORT_LE)` | ble-plx does this for us |
| **Indications** on the auth characteristic (`enableIndication`) | **Adopted.** We defaulted to notifications, which are not acknowledged at the link layer; a dashboard expecting indications can treat the peer as gone |
| MTU 517 | Have |
| `requestConnectionPriority(HIGH)` after MTU | **Adopted.** The handshake has a deadline on the bike's side and a lazy connection interval can miss it |
| — (not in the reference) | **Added:** `refreshGatt` on connect. Our bike is bonded over Classic, and Android can hand back a stale service cache from that |
| Handshake watchdog armed at **link-up**, not at first message | Have, via the authenticate budget |
| 25 s budget when the bike is known, 75 s on a first pairing | **Adopted** |
| Retry with 15 s then 45 s cooldowns; fresh GATT each time | **Adopted.** Without this a first pairing can never complete — see below |
| Session key pool persisted per bike | Have |
| Echo `HELLO` back, always; the dash owns the prompt decision | Have |

The single most important thing the audit turned up: **the dashboard drops the
link partway through a first pairing, and that is normal.** The reference's
comments are explicit that a bonded dash "kicks unauthenticated links itself at
~15 s" and that a genuine first pairing takes ~30 s of the rider confirming a
prompt. A single-attempt connect cannot get through that.

## Finding the bike

| | |
|---|---|
| Seeds the device list from **bonded devices** before scanning | **Adopted.** A dash connected over Classic for music often stops advertising, so a scan alone never sees it |
| Scans with **no filters** and lists everything | **Adopted.** We filtered on service UUID or a KTM-ish name, which hid exactly the device we wanted |
| 10 s settle between *seeing* the bike advertise and connecting | **Not adopted.** It exists for automatic reconnect after ignition-on, where the radio wakes before the pairing manager. Our connect is a deliberate tap, usually well after; the retry cooldowns cover the same ground |

## Known gaps

Not oversights — decisions, listed so they are visible.

- **The link dies when the app is backgrounded.** The reference runs a
  foreground service. This is the largest functional gap: it means our
  connection does not survive switching to Maps, and it is what a real riding
  app needs. Not yet built.
- **No automatic reconnect.** The reference has a 20 s watchdog, an
  `autoConnect=true` background request for reconnects, and recycling of
  attempts stuck too long, so ignition-on relinks in about a second. We
  reconnect only when the rider taps.
- **Banner text is truncated, not scrolled.** The dash shows 16 characters; the
  reference marquees longer messages across it and clears after 5 s.
- **No guidance-clear debounce.** The reference waits 4 s before blanking the
  centre display, because Google Maps removes and reposts its notification
  routinely while navigating.
- **Handlebar buttons (RCM, service `0100`)** are not read.
- **Telemetry over PRPC (service `0600`)** is not used — we read engine data
  through an OBD-II adapter instead, which works on bikes without that service.
- **No VIN or device-information probe.**
- **No write coalescing.** The reference drops a superseded write to the same
  characteristic so a slow link cannot build a queue of stale frames. Ours
  awaits each write, so a burst is serialised but not collapsed.
- **Bluetooth being switched off mid-session** is not handled specially; the
  reference watches adapter state and resumes on its own.
