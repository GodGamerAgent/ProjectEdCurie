# EdCurie demo walkthrough

The previous full project is on GitHub branch `future` at `3fa8a2f`. Use `main` for the demo.

1. Sign in as an assigned teacher. Create or open a course. In **Students**, add an approved institute email, name, date of birth and enrollment date. Verify that editing a student updates the course roster.
2. In **Topics**, add a chapter or topic. Use **Save and process resource** to upload a PDF, Markdown, or text file or paste course text. Check the AI summary and extracted exercises. A resource with no exercises has an empty problem bank. **Review and edit** opens the original source with live Markdown, KaTeX and code preview. Saving edits creates a new draft. Publish the reviewed source.
3. In **Onboarding**, select an extracted problem for the baseline, generate variants from a problem or from a summary, and generate learning preference questions. Enter a count and optional instructions for each generation. Edit or add custom questions, provide an expected answer for each academic item, and publish the baseline.
4. In **Timetable**, add a weekday slot using minute-level times, date range and timezone. Use **Get AI help** to suggest slots and load one into the form for review before saving.
5. Sign in as the enrolled student. Open the course and complete its academic and learning preference questions. Published topics are available after submission.
6. Open a topic and select **Learn** or **Practice**. Try a suggested reply, a custom text question, a code submission, one photo and one short voice message. Check math and code formatting. Voice transcription and images are processed for the tutor reply. The conversation stays on the open topic page for the demo.
7. If needed, verify deleting a resource removes it from the topic and deleting a course enrollment removes the student's course access. Resource history is retained in the database.

Run `npm run build` and `npm run test:isolated` for local verification. The latter uses a disposable database and mocked provider replies. Confirm real Groq generation, photo input, voice capture and transcription in Replit before presenting them.
