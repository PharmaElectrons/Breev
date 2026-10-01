# T06 retained manual session

Fresh scratch fixture:
`.scratch/runtime/t06-manual-160a74b616db46e984758fca3e2011f0/`.
The exact path is recorded by `.scratch/runtime/t06-manual-run-path.txt`.

Loopback PostgreSQL **5556**, renderer **http://127.0.0.1:55400**, API
**http://127.0.0.1:55357**. Interactive exec session **71883** was opened and
paused at stage 1 when this fixture record was created. Invoice
**MANUAL-T06-ENTRY**, barcodes **T060 / T061**.
`manual-manifest.json` contains the exact Product IDs and server facts;
`stage-1-ready.png` proves the headed fixture reached its initial page.

The fixture advances through normal facts, actual owner cost-grant removal,
restored grants with a held panel response, injected panel connection failure,
and restored Arabic/dark facts. Stage changes occur only when the operator
clicks Inspector Resume. The final pause was provided for the separate manual
checkpoint. The stakeholder explicitly reported T06 PASS on 1 October 2026;
see [the acceptance record](manual-checkpoint.md). The live stage was not
reinspected while recording PASS, and the session was left untouched.

Generator, body and launcher are scratch-only `t06-generate-manual.mjs`,
`t06-manual-fixture-body.txt`, `t06-start-manual.ps1`. No old fixture was reset.
Port 5553/PID1596, 5554/PID21436 and 5555/PID12876 remain the retained sessions.
The optional T05 retry proof remains ungenerated; this fixture does not create
or claim it.
