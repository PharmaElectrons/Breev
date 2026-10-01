# Separate T04 checkpoint — PASS

1 October 2026, Africa/Cairo. After reviewing this candidate and receiving the
prepared interactive session and detailed manual script, the stakeholder said
**“IT IS A PASS”**. This explicitly accepts T04 and authorizes its full local
pre-commit gate, focused commit and subsequent T05 work. It does not certify
which individual manual steps the stakeholder performed or accept T05.

T03's earlier PASS remains accepted. It does not accept T04.

The initiated [T04 prompt](../../../.scratch/milestone-2-phase-prompts/phase-1-purchasing-integrity.md)
requires: “Ask PASS/FAIL and stop.” This checkpoint is before T04 commit or T05.
The stakeholder may review the agent's targeted evidence and captures; no repeat
of the accepted T03 manual script is requested.

Review these exact rule 1 examples:

| Input                  |     Gross | Supplier allowance | Separate offer | Discounted cost |
| ---------------------- | --------: | -----------------: | -------------: | --------------: |
| None                   | 1,000 IQD |            100 IQD |              0 |         900 IQD |
| Fixed 50 IQD           | 1,000 IQD |            100 IQD |         50 IQD |         850 IQD |
| Percentage 5% of gross | 1,000 IQD |            100 IQD |         50 IQD |         850 IQD |

Gross Inventory/WAC/Supplier posting basis stays 1,000 IQD in each case. Exact
integer arithmetic, restart and immutable receipts are covered in [README](README.md).
A percentage correction recalculates against corrected gross; a fixed offer
retains its entered amount. Originals remain unchanged. The UI captures show
a fixed 4 IQD→10% (16 IQD) correction: gross 160, allowance 4, discounted cost
152→140, offer Delta +12, discounted-cost Delta −12 and no stock/payable effect.

Accepted: stakeholder T04 PASS. G-01 accountant/legal approval remains a
separate milestone-exit decision, even after this checkpoint is accepted.
