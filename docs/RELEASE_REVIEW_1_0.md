# Portfolio 1.0 release review

2026-10-26 · [PR #1: v2/rebuild → main](https://github.com/Yiping-Nash/BrandonTravel/pull/1)

**Conclusion:** no unresolved release-blocking engineering finding. This publishes a local single-user portfolio prototype, with recommendation quality still explicitly **Pending** human review. No new product refactor or paid model experiment was introduced for release.

| Check | Actual result |
|---|---|
| Bilingual README | Rewritten from the owner's English/Chinese drafts; checked in real Chrome on GitHub. Both render the new narrative and MIT notice. |
| Screenshots and demos | Four screenshots and three real-recording GIF previews load in both READMEs. All three original WebM downloads return HTTP 200 and match local byte sizes. GitHub's WebM file view does not provide reliable inline playback, so GIFs are the inline presentation. |
| Architecture | Both GitHub Mermaid embeds render all 11 nodes; no syntax error. |
| Internal links | All local README targets exist. GitHub file checks and any transient rate-limit responses are recorded in the machine-readable review evidence. |
| Python regression | `python -m pytest -q --junitxml=data/release/pytest.xml`: **332 passed, 18.05s**. Primarily deterministic/Fake-model tests, not 332 live recommendations. |
| Browser regression | Five Chrome checks: persistence, Board/Day/Week edits, native drag/resize, rollback, narrow layout, stale chat/navigation and timezone regressions; **5 passed, 15.7s**. Existing recorded live three-Trip journeys remain the model evidence. |
| Production build | `npm run build --prefix apps/web`: TypeScript + Vite passed. Existing 583.88 kB JS chunk warning remains non-blocking. |
| Public file scan | No configured secret or provider-token/private-key pattern detected; no `.env`, database, dependency directory, build directory or ZIP is tracked. Six configured secret values checked without printing them. Browser bundle scan also clean. |
| History scan | **1,865 blobs** reachable from pre-release V2 HEAD and old main scanned; no configured secrets or common credential patterns found. Missing historical objects were fetched before completing the scan. This is not a proof against every possible secret encoding. |
| Data minimization | 325 third-party source-body fields in 29 historical R1 records omitted from the current public tree; source URLs, hashes, outcomes, failures and metrics preserved and compared against local originals. Test-machine hostnames replaced with `local-test-runner`. Synthetic negative-test credential URLs remain intentionally. |
| Generated artifacts | Largest file is the 5.72 MB real research demo; three GIF previews total about 1.93 MB. Test code and compact evidence are intentional publication content; local raw records/DBs/logs/ZIPs remain ignored. |
| Independent review | Separate reviewer found no new blocker. Source provenance spotchecks confirmed the Kibo/calendar registry hashes and corresponding MIT notices; no material V1 source reuse under an incorrect MIT claim was found. This is a targeted engineering review, not an exhaustive legal audit. |
| CI | No GitHub Actions workflow is configured; the results above are local verification, not a cloud CI pass. |

## License and history

The owner selected **MIT for original V2 code**. [LICENSE](../LICENSE) and [NOTICE](../NOTICE.md) distinguish that grant from third-party components and V1. The old root license was **Open Sunsama — Non-Commercial License, Circo**; its removal from the V2 working tree does not relicense V1. Both adopted UI components retain their original MIT notices.

Before merge, the remote backup branch `archive/v1-before-portfolio-1.0` and existing tag `archive/v1-before-v2-20261026` both preserve `1de429e38fb047084986d1e9577fe3deecde0f6d`, the old main tip and its license. Merge uses a merge commit, retains `v2/rebuild`, and is followed by a `v1.0.0` annotated tag at the merged main commit. No force push or history rewrite is used. Earlier historical source excerpts remain in existing Git history; current-tree publication minimization does not erase old revisions.

## Remaining product limits

The app is a local single-user prototype. Model/source availability depends on configured provider accounts. Research examples are partial; opening, booking and accessibility facts may remain unknown. Human quality review is Pending, as stated in both READMEs. The map is a static provider map with route references; no community research, production login, booking or payment is claimed.

See [machine-readable release evidence](../evaluation/release-review-1.0.json), [Portfolio evidence](PORTFOLIO_EVIDENCE.md) and the [existing module/integration review](agent-learning/review-portfolio-integration.md).
