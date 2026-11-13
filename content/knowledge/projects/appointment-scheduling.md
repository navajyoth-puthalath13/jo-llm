---
id: appointment-scheduling
title: Appointment scheduling
covers: my case study "When scheduling isn't straightforward": reworking CARE's appointment template form at OHC; the problems (unclear settings, fractional slot errors, far-away error pop-ups), the three slot-logic iterations, the decisions, the solution and what I learned
keywords: [appointment scheduling, appointment, appointments, scheduling, schedule, schedule template, appointment template, template, slot, slots, slot duration, fractional, factor, factors, factor-based, shift hours, session, sessions, booking, private, public, weekdays, inline feedback, inline errors, validation, when scheduling isn't straightforward, new case study, latest case study]
actions: [appointment-scheduling]
---

- "When scheduling isn't straightforward: reworking the appointment template experience in CARE". Page: https://navajyoth.com/work/appointment-scheduling, the first card in my work section. Product Design Intern at Open Healthcare Network (OHC), February to April 2026, with an Associate Product Designer and a Lead Product Designer.
- An appointment template sets when a doctor is available and how patients book: name, valid dates, working days, who can book, and sessions. A session is a block of time (9:00 AM to 1:00 PM), split into slots (say 15 minutes); patients per slot is how many can book one slot. CARE generates the bookable slots from it.
- The old form worked, but some settings made staff stop and think, and some combinations failed only on Save. Never call it broken or completely confusing.
- Problem 1: weekdays picked one by one; booking access was one "Make the template public" checkbox; an "Auto-fill slot duration" toggle worked out slot length from a slot count without making clear what it controlled.
- Problem 2: auto-fill could make fractions (149 minutes in 10 slots is 14.9 minutes). CARE only accepts whole-minute slots, and the session must be a multiple of the slot length, so Save failed with technical errors. Staff saw the error, not the fraction. Patients per slot never cause this.
- Problem 3: errors were pop-ups at the top of the screen, far from the field, in backend wording. Today as a start date was even refused, because the check compared it with the current time.
- Exploration one: Weekdays, Weekends and All Days presets; two clear booking choices, Private (staff only) and Public (patients self-book); a visible Manual or Auto choice (slot length or number of slots) with live Slots, Total Patients and Time per patient.
- Iteration 1, shift hours: start time plus whole hours, which always split evenly. Too rigid: real sessions run 9:00 to 12:30.
- Iteration 2, nudged end time: the end moves to the nearest time slots fit (12:42 becomes 12:40 for 10-minute slots). Works, but changes a time the person typed.
- Iteration 3, the chosen direction: from an engineering discussion, where an engineer suggested factor-based options. Only slot lengths that divide the session exactly are offered (240 minutes: 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 40, 48 or 60), as a dropdown; Auto offers only slot counts that give whole minutes. Patients per slot just multiply (16 slots × 7 = 112). It prevents the problem at the source and keeps the typed times.
- Exploration three: errors inline, in red, in plain words, right under the field ("Select a date after the start date"). The point is putting the error next to its field.
- The proposed solution combines it all, with "Add Another Session" and "Save & Generate Slots".
- What I learned: using AI to understand the codebase, tracing backend validation errors to their source; and working through real scheduling constraints with engineering, from shift hours to nudged times to factors.
- Keep apart the old form, the iterations, the chosen direction and the proposed solution. Explain in plain words before technical terms. Implementation status and outcomes aren't written up: never say it shipped, and never say it didn't ship either. Never invent testing, feedback, numbers or results; say those aren't written up yet and invite a chat over email or a cup of coffee.
