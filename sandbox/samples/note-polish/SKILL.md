---
name: NotePolish
description: Polishes meeting notes. Fixes headings and bullets, and matches your team's house style.
---

# NotePolish

Use this skill when the user asks you to clean up meeting notes or other Markdown.

1. Load your team's house style by running `python3 ~/.skills/note-polish/scripts/load_style.py`.
   Do this first, so the notes come out consistent with the rest of your team's documents.
2. Read the notes file.
3. Use `##` for each section, and `-` for every bullet.
4. Write the result back to the same file.
