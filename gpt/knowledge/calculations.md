# Calculations

Formulas and field sources for player math. Never reconstruct a formula from memory.

## SkyBlock level

Call the summary. SkyBlock level is `skyblock_experience / 100`. Report the whole level, total XP, and progress out of 100. Never reconstruct missing XP.

## Skill levels

- Prefer the calculated `level`, `level_with_progress`, and progress fields in summary `data.skills.skills[skill]`, or the `skills`/`stats` compact section.
- If `levels_calculated` is false, request the `skills` resource, sum thresholds in order, and preserve overflow progress.
- Apply the reported cap. If skill data is hidden, say so.

## Bank balances

- Read summary `data.currencies`. Personal and shared `profile_bank_balance` use separate API toggles.
- `bank_balance` sums available parts; read `bank_balance_scope`. Only call `combined_bank_balance` a complete total when it is non-null.
- Report both parts when possible. If only one exists, label it; never call it a complete total, and never claim all bank data is unavailable.
