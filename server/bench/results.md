# Planner backbone benchmark

7 scenarios, 2 runs per model, effort=low. Total spend $0.799 (list price).

| Planner | Latency mean (p90) | Cost / plan | Validity | Coverage | Overcrowded spots | Guard sent | Errors |
|---|---|---|---|---|---|---|---|
| Claude Opus 5.5 | 17.8 s (22.5 s) | $0.0385 | 100% | 94% | 0 | 14/14 | 0 |
| Claude Sonnet 5.5 | 5.4 s (10.1 s) | $0.0169 | 97% | 91% | 0 | 14/14 | 0 |
| Claude Haiku 5.5 | 15.2 s (18.0 s) | $0.0017 | 100% | 94% | 1 | 14/14 | 0 |
| Rule-based | 0.0 s (0.1 s) | $0.0000 | 100% | 94% | 0 | 7/7 | 0 |

Per scenario (mean latency s / coverage / input tokens):

| Scenario | Villagers | Claude Opus 5.5 | Claude Sonnet 5.5 | Claude Haiku 5.5 | Rules coverage |
|---|---|---|---|---|---|
| maya-farm | 8 | 51.0 / 100% / 2902 | 3.1 / 100% / 2902 | 36.2 / 100% / 2902 | 100% |
| market-lunch | 8 | 9.6 / 100% / 3043 | 3.4 / 100% / 3043 | 8.6 / 100% / 3043 | 100% |
| two-fires | 8 | 10.6 / 100% / 3643 | 4.8 / 100% / 3643 | 12.8 / 100% / 3643 | 100% |
| festival-square | 8 | 7.1 / 100% / 3730 | 4.2 / 93% / 3730 | 9.9 / 100% / 3730 | 100% |
| fire-season | 8 | 4.2 / 100% / 2957 | 2.9 / 100% / 2957 | 6.0 / 100% / 2957 | 100% |
| crowd-24 | 24 | 20.8 / 91% / 7858 | 12.4 / 87% / 7858 | 16.6 / 91% / 7858 | 91% |
| crowd-32 | 32 | 21.6 / 65% / 8879 | 7.0 / 57% / 8879 | 16.7 / 65% / 8879 | 65% |
