# RD-03D Radar Card

A live Home Assistant dashboard card for the Ai-Thinker RD-03D multi-target radar.

## Features

- Three simultaneous moving targets
- Animated radar sweep
- Target trails
- Range rings in feet
- Live X/Y location
- Distance, angle, speed, direction, and movement status
- Desktop and mobile layouts
- No Plotly dependency
- No other HACS card dependency

## HACS installation

This repository must first be uploaded to a public GitHub repository named:

`rd03d-radar-card`

Then:

1. Open **HACS → Dashboard**.
2. Open the three-dot menu and choose **Custom repositories**.
3. Enter the GitHub repository URL.
4. Choose **Dashboard** as the category.
5. Add the repository.
6. Find **RD-03D Radar Card** in HACS and install it.
7. Refresh Home Assistant.

HACS should add the frontend resource automatically. If it does not, add:

`/hacsfiles/rd03d-radar-card/rd03d-radar-card.js`

as a JavaScript module under **Settings → Dashboards → Resources**.

## Dashboard configuration

Add a Manual card and use the configuration in:

`examples/dashboard.yaml`

Verify all entity IDs in Home Assistant. ESPHome-generated entity IDs can differ from the examples.

## Required measurements

Each target should provide:

- Presence
- X position in feet
- Y position in feet
- Distance in feet
- Angle in degrees
- Speed in feet per second

Direction and movement text entities are optional.

## Main options

| Option | Default | Description |
|---|---:|---|
| `title` | RD-03D Radar | Card heading |
| `max_range` | 30 | Radar range in feet |
| `show_sweep` | true | Animated sweep |
| `show_trails` | true | Target movement trails |
| `trail_length` | 18 | Stored trail points |
| `update_interval` | 250 | Trail sampling interval in ms |
| `sweep_duration` | 4200 | Sweep animation duration in ms |

## Notes

The RD-03D is a moving-target tracker. A completely motionless person may disappear from the radar output.
