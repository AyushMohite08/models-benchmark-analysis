# ORBITAL 09 — Single-File HTML Benchmark

You are a senior product designer and frontend engineer tasked with creating a visually exceptional mission-control interface for a fictional deep-space exploration agency called **ORBITAL 09**.

## The concept

Humanity has established a research station near Saturn's moon Enceladus. Scientists are monitoring an autonomous probe that has detected unusual thermal activity beneath the moon's icy surface. The operator needs to monitor the mission, understand the probe's condition, and inspect recent telemetry.

Design a working, cinematic mission-control web interface—not a conventional admin dashboard.

## Visual direction

Invent a distinctive visual identity inspired by spacecraft instrumentation, scientific research terminals, and cinematic science-fiction interfaces.

Use a near-black navy background, icy cyan highlights, restrained amber warnings, fine grid lines, subtle atmospheric gradients, and highly legible technical typography. Use contrast, scale, spacing, and intentional asymmetry to establish hierarchy.

The interface should feel like a credible piece of operational software from the near future, not a generic template covered in neon effects. Avoid excessive glow, meaningless decoration, and dense walls of tiny text.

## Required content

Include all of the following:

- A compact agency identity, mission identifier, and navigation.
- A prominent mission-status section with the current mission phase and elapsed time.
- A visually striking central visualization of Enceladus and the probe's orbital path. Create it using inline SVG, CSS, or HTML; do not depend on external image assets.
- At least four telemetry metrics, such as probe battery, signal strength, orbital altitude, and thermal readings.
- A recent-events timeline containing at least four mission events.
- A clearly differentiated warning or anomaly associated with the thermal readings.
- A probe control panel with at least three meaningful interactive controls.
- A compact communications or signal-status area.

Use coherent fictional data throughout. Make the information feel as if it belongs to one real mission.

## Functional requirements

Implement at least these interactions:

1. A tab or navigation control that switches the visible section or content.
2. A mission control that changes the probe's displayed operational state.
3. A telemetry or visualization control that visibly changes the displayed data or presentation.
4. A dismissible warning or notification.

Every interactive control must produce a visible, meaningful result. Do not use decorative buttons that do nothing.

## Technical constraints

- Deliver exactly one complete, self-contained HTML document.
- Include all CSS and JavaScript inside the HTML file.
- Use vanilla HTML, CSS, and JavaScript. No React, frameworks, build tools, or external JavaScript libraries.
- Do not require a backend, API keys, a database, or network requests.
- Do not rely on external images, fonts, or assets. Use CSS, inline SVG, and system fonts.
- The document must work when saved as `index.html` and opened directly in a modern desktop browser.
- Use semantic HTML, accessible labels, keyboard-operable controls, and responsive layouts.
- The interface must remain usable on smaller screens as well as desktops.
- Use realistic sample data; do not pretend to receive live telemetry.

## Quality bar

Prioritize exceptional visual composition, typography, detail, consistent spacing, thoughtful empty space, and polished interaction states.

Use small animations only where they improve comprehension or atmosphere. Respect reduced-motion preferences.

Do not explain your approach, provide a design specification, or include setup instructions. Return only the complete HTML document, starting with `<!DOCTYPE html>`.