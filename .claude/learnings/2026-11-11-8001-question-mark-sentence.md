# A punctuation mark inside a UI name is not a sentence boundary

Refs #8001. The formatter treated any punctuation followed by whitespace as
the end of the first sentence, truncating the owner-provided `Why? next to ...`
example to its UI name alone.

Require whitespace followed by an uppercase Unicode letter, or the end of the
text. Preserve lower-case continuation, paragraph boundaries and the existing
public formatter interface. Fixed literal dates keep the formatting tests
independent of the wall clock. CI and local verification both invoke the tests.

This changes only local copy/paste output. No Discord message is sent and no
new player wording or game behavior is introduced.
