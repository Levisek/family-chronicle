Golden outputs of the Python build (the example site and a Markdown corpus) that the JS engine in `engine/` must reproduce.
Regenerate with `.venv/bin/python -I tests/golden/make_golden.py` and never edit the files by hand.
`privacy/` holds random inputs with the results of the Python `redact` and `check_output` (dates in many written forms, names, e-mails, phone numbers); `tests/engine/privacy-golden.test.mjs` requires the JS to match them exactly.
