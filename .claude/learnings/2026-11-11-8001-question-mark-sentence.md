# A punctuation mark inside a UI name is not a sentence boundary

Refs #8001. The formatter treated any punctuation followed by whitespace as
the end of the first sentence, truncating the owner-provided `Why? next to ...`
example to its UI name alone.

Keep ordinary period/exclamation sentence boundaries. For a question mark,
preserve a following lower-case Unicode continuation as part of the sentence.
Review caught that requiring uppercase after every punctuation mark joined
real sentences beginning with numbers, quotes or symbols (existing notes
7.331 and 7.363). Five regression cases failed before the corrected rule and
pass afterwards. Preserve paragraph boundaries and the public formatter
interface. Fixed literal dates keep the tests independent of the wall clock.
CI and local verification both invoke the tests.

This changes only local copy/paste output. No Discord message is sent and no
new player wording or game behavior is introduced.
