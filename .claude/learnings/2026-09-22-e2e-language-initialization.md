# Wait for initialization before switching the test language

Refs #5470. An i18n instance can exist before its asynchronous initialization
finishes. Switching to English during that window can be overwritten by the
initial Danish language load. Wait for isInitialized before changeLanguage,
then keep the existing assertion that English has settled. No product behavior
or timeout is changed; this fixes the ordering in the e2e helper.
