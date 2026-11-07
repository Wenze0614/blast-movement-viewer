# 01 — Research Summary

> Researched Sat 7 Nov 2026. ⚠️ marks anything unverified, assumed, or where sources disagree.
> Sources are listed at the end. The company is **Augment Technologies**. It is **not** Blast Movement Technologies (BMT), which sells physical in-blast monitors.

---

## 1. Augment Technologies: what they do

| Item | What the sources say | Source |
|---|---|---|
| Who | A West Australian AI/mining software company. Listings put it in Subiaco, Perth. One listing says Rivervale ⚠️. | [Augment About][a-about], [ChannelLife][cl] ("Perth-based"), search snippets for [BusinessNews][bn] / [CB Insights][cbi] |
| Founded | 2018 ⚠️. This comes only from search snippets of paywalled profiles. Augment's own site doesn't give a year. | [BusinessNews][bn], [CB Insights][cbi] |
| People | **Brice Gower**, Co-founder & CEO (Augment site). **Greg Hardwich**, Co-founder, called "Chairman" by AMR/SME and "Chief Revenue Officer" by ChannelLife ⚠️ (sources disagree). Tika Elliot (CTO) comes from your interview; no public source I read names them. | [Home][a-home], [AMR][amr], [SME][sme], [ChannelLife][cl] |
| Product | **OMP (Ore Movement Policy)**: blast movement prediction and modelling that is software-only, AI-driven and 3D. | [OMP page][a-omp] |
| Technology claim | Augment describes it as a physics engine combined with machine learning. Results are validated continuously so the algorithms keep learning. Augment calls itself the first and only blast movement solution to combine the two. That is their own claim, not independently verified. | [Home][a-home], [About][a-about], [IM][im], [WA Innovators][wai] |
| Inputs | The in-situ (grade control) block model, blasthole data and survey pickups. They say no external measurement hardware is needed. ⚠️ The home page also mentions measuring with drones, and the site doesn't reconcile the two. | [OMP page][a-omp], [Home][a-home] |
| Output | A post-blast 3D block model, which they trademark as the **Muckpile Block Model™**. The site says it **keeps the in-situ model's total tonnage and grade**, with metal redistributed to its post-blast location at high resolution. It also produces a mark-out for load & haul and feeds back to Drill & Blast on whether the design was followed. Movement is described as hundreds of thousands of 3D vectors, available minutes after the blast. | [OMP page][a-omp], [Blog 2020][a-blog], [Home][a-home] |
| Integrations | Works with general mining software such as Datamine. **Hexagon partnership (Feb 2024):** integrates with **Hexagon MinePlan Block Model Manager** (and its API). Hexagon's physical Blast Movement Monitors are *optional*, used as an extra measurement and for training the AI. | [Home][a-home], [AMR][amr], [SME][sme], [ChannelLife][cl] |
| Partners / customers | **Thiess** (global mining contractor) partnered in June 2024 to use the software to produce Muckpile Block Models. The home page logo strip also shows First Quantum, Northern Star, Ravenswood Gold, IMDEX, Datamine and others, but the relationships aren't stated ⚠️. There is a gated "FQM case study" (not read). | [IM Mining][im], [Home][a-home], [News][a-news] |
| Recognition | Finalist for the **2026 WA Innovators of the Year, Growth Innovation Award**. I didn't check whether they won. | [WA.gov.au][wai] |
| Value claims | Up to 5% more ore yield and tens of millions of dollars a year per mine. No case study backs these figures publicly ⚠️. | [Home][a-home], [ChannelLife][cl] |
| UI | They mention a customisable interface for all stakeholders and show an "OMP Dashboard" screenshot. The site doesn't say whether it's a web app; the job ad says it is. | [OMP page][a-omp], job ad |

**Where it sits in the workflow**

```
Drill (blastholes sampled → grade control block model) → Blast design → BLAST
   → [Augment OMP: in-situ model + blastholes + survey → Muckpile Block Model, minutes after the blast]
   → Geology marks out ore/waste dig polygons on the muckpile
   → Dig/load (shovel follows mark-out) → Haul (ore → mill/ROM pad, waste → dump)
   → Feedback to Drill & Blast (did the design behave as intended?)
```

**What matters for the prototype:**
1. The output is a re-gridded post-blast block model that conserves tonnes and metal. I can show this with a conservation unit test.
2. The decision it drives is the **dig line / mark-out**, so the adjusted-dig-line feature goes to the heart of the product.
3. The scale is hundreds of thousands of vectors per blast, so the rendering has to scale too.

---

## 2. Domain basics (for a software engineer)

**Block model.** A 3D grid of cuboid cells over the orebody. Each cell stores attributes such as grade, density, rock type and ore class. By convention X is East, Y is North and Z is elevation. In Datamine the model origin is the *minimum corner* of the first cell, not its centre, and cells are indexed by IJK; parent cells can be split into sub-cells ([Datamine intro][dm1]). Grade-control models use small blocks, commonly 2.5–5 m ⚠️ (typical, varies by site).
- **Tonnes** = volume × density, e.g. 2.5 × 2.5 × 2.5 m × 2.7 t/m³ = 42.2 t ⚠️ (standard formula, though the Datamine pages don't spell it out).
- **Grade** = metal concentration: g/t for gold, % for copper or iron. Average grade of a set of blocks = Σ(tᵢ·gᵢ)/Σtᵢ (tonnage-weighted). **Metal** = t × g, e.g. grams of Au.
- **Cut-off grade**: the threshold above which a block counts as ore (e.g. 0.5 g/t Au ⚠️, illustrative).
- **Evaluating inside a polygon/wireframe**: either *full-cell*, where a cell counts if it is mostly inside (or its centroid is), or *partial/proportional*, where the volume fraction inside is counted ([Datamine evaluation][dm2], [Vulcan][vul]).

**Bench geometry.**
- **Bench**: one horizontal step of the pit, often 5–15 m high ⚠️. **Crest** = top edge, **toe** = bottom edge. A **flitch** is a sub-layer of a bench that is dug separately (e.g. two 5 m flitches in a 10 m bench).
- **Free face**: an exposed vertical face, usually left by the previous blast. Rock moves mainly *toward* it, the direction of least resistance.
- **Blast holes** are drilled in a grid. **Burden** = distance from a hole to the free face (or to the next row). **Spacing** = distance between holes in the same row. Both are typically a few metres ⚠️.
- **Powder factor** = explosive per unit of rock, e.g. kg/m³ or kg/t. **Delay timing** (the firing sequence) controls the movement direction. A V-shaped sequence throws rock toward a single free face; echelon sequences are used with two free faces ([Global Mining Review][gmr]).

**Swell.** Broken rock takes more space than solid rock, so loose volume = bank volume × swell factor (≈1.3–1.5 ⚠️ typical). Tonnes are unchanged; bulk density falls.

**Muckpile.** The heap of broken rock after the blast. It throws out past the original face and slumps to roughly the angle of repose (~35–40° ⚠️). Measured data from Husab mine show the top of the bench moving much more than the bottom: about 6.5–9 m horizontally and 2–4 m vertically near the top, versus about 3–4 m horizontally and under 1 m vertically lower down ([Xie et al. 2024, abstract][husab]). Movement is mostly horizontal ([GMR][gmr]). Because movement varies with depth, ore can end up under waste and vice versa.

**Dig lines / ore polygons (mark-out).** 2D polygons in plan view that tell the shovel what is ore and what is waste. In the field they are pegs, flagging or GPS boundaries in the machine's guidance system. They are drawn from the grade control model. After a blast they should be **shifted by the movement vectors** ([Thornton et al. 2005][thornton]); otherwise the shovel digs the *old* boundary on *moved* rock.

**Ore loss and dilution** (per-block bookkeeping):
| | Sent to mill (inside ore polygon) | Sent to waste dump |
|---|---|---|
| **Block is ore** (grade ≥ cut-off) | ✅ ore recovered | ❌ **ore loss** |
| **Block is waste** | ❌ **dilution** | ✅ correct |

- **Ore loss %** = ore tonnes sent to waste ÷ total ore tonnes.
- **Dilution %** = waste tonnes sent to the mill ÷ total tonnes sent to the mill.
- ⚠️ These are common definitions, but sites differ. Some define dilution as waste ÷ ore (a ratio, not a share of mill feed), and some report *metal* loss instead of tonnes. None of the sources I could read gave a formula; the verbal definitions match ([GMR][gmr], [T&F chapter][tf]). The prototype will show the formula in a tooltip.

---

## 3. How blast movement is predicted in industry

| Approach | How it works | Inputs | Notes / source |
|---|---|---|---|
| **Physical measurement** | Monitors are placed in holes before the blast and located afterwards, giving true 3D vectors at a few points. Older methods (poly-pipe, chains, sandbags) were inaccurate or impractical. | Monitor positions before and after | JKMRC electronic monitors ([Thornton 2005][thornton]). This is what BMT is known for. Hexagon also sells monitors. Point data only, so it must be interpolated. |
| **Empirical / regression** | Fit movement against blast design variables. | Burden, spacing, powder factor, explosive per hole, stemming, subdrill, hole row, sequence, distance to free face, density, Young's modulus | Domingo et al. 2015: multiple linear regression, R² > 0.8, calibrated on 137 face points ([AusIMM][ausimm]) |
| **Physics simulation** | Discretise the bench, give blocks initial velocities from the blast design and confinement, then simulate motion with a physics engine. Calibrated against measured movement and muckpile shape. | Design, timing, explosive and rock properties | JKVBOC ([Bujes et al.][jkvboc]). DEM approaches exist too ⚠️ (general knowledge, not read here). |
| **Physics + ML (Augment)** | A physics engine combined with machine learning, calibrated per site and improving over time with validation data (optionally monitors). | In-situ block model, blastholes, survey | Their own description ([Augment][a-home]). The internals are not public. |
| **Dig-limit optimisation under uncertainty** | Simulate many movement realisations (copula + Monte Carlo, 1,000 runs), then use mixed-integer linear programming to choose dig limits. Ignoring movement increases loss and dilution and overstates profit. | BMM data | Hmoud & Kumral 2022 ([Springer][hk]). Full text not read; summary from abstract snippets ⚠️. |

**What my heuristic leaves out (say this in the README):**
- delay timing and initiation sequence
- explosive energy and its distribution by hole
- rock mass properties and geological structure
- confinement and multiple free faces (the MVP has one)
- hole-to-hole interaction
- vertical heave and mixing within the column (my stacking keeps the vertical order)
- fragmentation
- calibration against any measured data

The movement shape is only *qualitatively* informed by published observations: movement is biggest at the front and top, mostly horizontal, and there is swell.

---

## 4. Glossary

| Term | Meaning |
|---|---|
| Block model | 3D grid of cells carrying grade, density, rock type and class |
| Parent / sub-block | Full-size cell / a subdivision of it, used near boundaries |
| IJK | Integer cell index (i,j,k) along X/Y/Z |
| Grade | Metal concentration (Au g/t, Cu %) |
| Cut-off grade | Threshold separating ore from waste |
| Tonnes | Volume × density |
| Bench / flitch | One pit step / a sub-layer of a bench dug separately |
| Crest / toe | Top / bottom edge of a bench face |
| Free face | Open face that rock moves toward |
| Burden / spacing | Hole-to-face (row) distance / hole-to-hole distance in a row |
| Powder factor | Explosive per volume or mass of rock (kg/m³, kg/t) |
| Stemming / subdrill | Inert fill at the top of a hole / extra hole depth below the floor |
| Swell (factor) | Loose volume ÷ bank (in-situ) volume after breaking |
| Angle of repose | Steepest stable slope of loose rock |
| Muckpile | The pile of broken rock after the blast |
| Dig line / ore polygon / mark-out | Plan-view boundary between ore and waste that the shovel digs to |
| Ore loss | Ore sent to the waste dump |
| Dilution | Waste sent to the mill |
| ROM | Run-of-mine (ore pad before the mill) |
| BMM | Blast movement monitor (physical device) |
| OMP | Augment's product, Ore Movement Policy. **Don't use this name in the prototype UI.** |
| Muckpile Block Model™ | Augment's trademarked output name. **Use "post-blast block model" instead.** |

---

## Sources

[a-home]: https://augmenttechnologies.ai/
[a-omp]: https://augmenttechnologies.ai/products/ore-movement-policy/
[a-about]: https://augmenttechnologies.ai/about/
[a-blog]: https://augmenttechnologies.ai/introducing-ai-driven-3d-blast-movement-modelling/
[a-news]: https://augmenttechnologies.ai/news-insights/
[amr]: https://australianminingreview.com.au/news/hexagon-partners-with-ai-specialists-on-mine-blast-movement/
[sme]: https://me.smenet.org/hexagon-partners-with-augment-technologies-for-tools-to-help-mines-transform-measurement-of-blast-movement/
[cl]: https://channellife.com.au/story/augment-technologies-unveils-ai-mining-tech-in-partnership-with-hexagon
[im]: https://im-mining.com/2024/06/20/thiess-partners-with-augment-technologies-on-blast-movement-solutions/
[wai]: https://www.wa.gov.au/organisation/department-of-energy-and-economic-diversification/wa-innovators-of-the-year-2026-growth-innovation-finalists
[bn]: https://www.businessnews.com.au/Company/Augment-Technologies
[cbi]: https://www.cbinsights.com/company/augment-technologies
[dm1]: https://docs.dataminesoftware.com/StudioRM/2.0/STUDIO_RM/block_models_introduction.htm
[dm2]: https://docs.dataminesoftware.com/StudioRM/Latest/STUDIO_RM/Block_Models_Evaluation.htm
[vul]: https://help.maptek.com/vulcan/2024.0.0/Content/topics/Block/Advanced_GradeTonne_Report/Block_adv_gradetonne_report_Gradevariables.htm
[thornton]: https://onemine.org/documents/measuring-blast-movement-to-reduce-ore-loss-and-dilution
[jkvboc]: https://www.onemine.org/documents/jkvboc-blast-movement-model-applications-for-ore-control-at-open-pit-mines
[ausimm]: https://www.ausimm.com/publications/conference-proceedings/11th-international-symposium-on-rock-fragmentation-by-blasting/dilution-ore-grade-and-blast-movement-calculation-model/
[husab]: https://castjournals.cast.org.cn/joweb/bp/EN/1241699621592945296
[gmr]: https://www.globalminingreview.com/mining/10052023/featured-article-blast-and-loose/
[hk]: https://link.springer.com/doi/10.1007/s11053-021-09998-z
[tf]: https://www.taylorfrancis.com/books/9781482211894/chapters/10.1201%2Fb16702-14

- Augment: [Home][a-home] · [OMP][a-omp] · [About][a-about] · [Blog (Dec 2020)][a-blog] · [News][a-news]
- Partnerships: [AMR, 6 Feb 2024][amr] · [SME, 5 Feb 2024][sme] · [ChannelLife, 8 Feb 2024][cl] · [IM Mining (Thiess), 20 Jun 2024][im] · [WA Innovators 2026][wai] · [BusinessNews][bn] (paywalled) · [CB Insights][cbi] (snippet only)
- Block models: [Datamine intro][dm1] · [Datamine evaluation][dm2] · [Maptek Vulcan grade variables][vul]
- Blast movement: [Thornton et al. 2005][thornton] (abstract) · [Bujes et al., JKVBOC][jkvboc] (abstract) · [Domingo et al. 2015][ausimm] (abstract) · [Xie et al. 2024, Husab][husab] (abstract) · [Rezk, GMR 2023][gmr] · [Hmoud & Kumral 2022][hk] (abstract snippets) · [Ore dilution chapter, T&F][tf] (abstract)
- **Could not read:** Hexagon press release (403), AJOL Newmont Ahafo paper (empty response), Queen's mine-plan PDF (DNS failure), Hmoud & Kumral full text (login wall). Claims from these are not used.
