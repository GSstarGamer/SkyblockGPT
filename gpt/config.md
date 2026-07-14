# Custom GPT configuration

## Name

SkyBlockGPT

## Description

An unofficial Hypixel SkyBlock assistant that checks live profiles, HotM/HotF, skills, gear, accessories, inventories, NBT, Bazaar, auctions, and market history—then does the math and gives sourced progression advice. Made by GS

## Conversation starters

1. My IGN is AdamWarlock447 and my profile is Mango. Find the cheapest exact path from my current Magical Power to 600 MP. Use only accessories I do not actively own, verify every recipe and collection/skill requirement, compare Bazaar craft cost against current LBin, include slot-upgrade costs, and solve the minimum-total-cost combination.
2. Should I buy a Hyperion right now? Compare the ten cheapest modifier-compatible BINs, twenty recent sales, and one-month history. Calculate median, 10% trimmed mean, volatility, outlier bounds, and the current premium or discount after adjusting for stars, recombobulation, enchants, gemstones, and scrolls.
3. My IGN is Paradox_77 and my profile is Mango. List every occupied Forge slot with raw process JSON, exact start and finish timestamps, remaining time, and completion percentage. If Hypixel omits a duration, verify it on the exact official wiki page before calculating anything.
4. Scan every exposed inventory, backpack, Ender Chest page, and sack for Bazaar products. Calculate instant-sell and sell-offer liquidation values, spread loss, and capital concentration, then rank my ten largest holdings by seven-day volatility without mixing Bazaar and AH data.

## Capabilities

- Web Search: on, for the official Hypixel SkyBlock Wiki and correctly matched images.
- Code Interpreter & Data Analysis: on, for optimization, statistics, and charts.
- Image Generation: optional; never substitute generated art for factual wiki images.

## Actions

1. `actions/minecraft-username.openapi.json`
   - Authentication: None
   - Privacy policy: `https://privacy.microsoft.com/en-us/privacystatement`
2. `actions/hypixel-worker.openapi.json`
   - Authentication: API key
   - Header: `X-GPT-Key`
   - Value: the same private value stored as the Worker's `GPT_SHARED_SECRET`
   - Privacy policy: `https://skyblock-gpt-proxy.girishsonic8.workers.dev/privacy`
3. `actions/skycofl.openapi.json`
   - Authentication: API key using Bearer authentication
   - Value: the raw SkyCofl account token, without `Bearer` or quotes
   - Privacy policy: `https://coflnet.com/privacy`

Paste `gpt/instructions.md` into the GPT's Instructions field. Never put credentials in this repository.

