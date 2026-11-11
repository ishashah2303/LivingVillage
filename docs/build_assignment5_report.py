"""Rebuild the two-page Assignment 5 report with ReportLab."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, PageBreak

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/Assignment5_LivingVillage_hc1242_ins28.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
font = Path('C:/Windows/Fonts')
if (font / 'segoeui.ttf').exists():
    pdfmetrics.registerFont(TTFont('Body', str(font / 'segoeui.ttf')))
    pdfmetrics.registerFont(TTFont('BodyBold', str(font / 'segoeuib.ttf')))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')
else:
    pdfmetrics.registerFontFamily('Helvetica', normal='Helvetica', bold='Helvetica-Bold')
FACE = 'Body' if 'Body' in pdfmetrics.getRegisteredFontNames() else 'Helvetica'
styles = {
    'body': ParagraphStyle('body', fontName=FACE, fontSize=9.4, leading=12.3, spaceAfter=5, textColor=colors.HexColor('#242424')),
    'title': ParagraphStyle('title', fontName=FACE, fontSize=14.5, leading=18, spaceAfter=4),
    'head': ParagraphStyle('head', fontName=FACE, fontSize=11, leading=14, spaceBefore=8, spaceAfter=5, keepWithNext=True),
    'small': ParagraphStyle('small', fontName=FACE, fontSize=8.4, leading=11, spaceAfter=4, textColor=colors.HexColor('#555555')),
    'cell': ParagraphStyle('cell', fontName=FACE, fontSize=8.5, leading=11, alignment=TA_LEFT),
}
story = []
def p(text, style='body'):
    return Paragraph(text, styles[style])
def add(text, style='body'):
    story.append(p(text, style))
def heading(text):
    add('<b>' + text + '</b>', 'head')
def table(rows, widths):
    t = Table([[p(cell, 'cell') for cell in row] for row in rows], colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#efefef')),
        ('GRID', (0,0), (-1,-1), .4, colors.HexColor('#bbbbbb')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.extend([t, Spacer(1,5)])

add('<b>Living Village - Assignment 5: Beta Build</b>', 'title')
add('Group JJ: Harjeet Singh Chahal (hc1242, group leader), Isha Nimesh Shah (ins28)<br/>AI for Visual Computing | Beta release notes and revised schedule | November 11, 2026', 'small')
add('<b>Playable build:</b> <link href="https://ishashah2303.github.io/LivingVillage/" color="#1f5fa8">https://ishashah2303.github.io/LivingVillage/</link><br/><b>Public source:</b> <link href="https://github.com/ishashah2303/LivingVillage" color="#1f5fa8">https://github.com/ishashah2303/LivingVillage</link>', 'small')
add('Choose <b>Rule-based only</b> to avoid model calls. The build also runs without the optional planner server, using browser fallback rules. Both new events are under <b>Sandbox &gt; Events</b>.', 'small')
heading('1. Primary pillar recap and secondary-pillar integration')
add('<b>NPC AI / behavior trees:</b> the alpha established eight named residents with routines, needs, social relationships and episodic memory. A reactive tree prioritizes emergencies over helping friends, events and ordinary work. The inspector exposes the live tree, goal and decision source. These are prior achievements, retained in the beta.')
add('<b>Navigation affects the game:</b> fires and edited obstacles update the Recast/Detour TileCache; villagers move as crowd agents. Immediate flee/guard behaviors act while a slower planner coordinates destinations. Accepted commands feed the same behaviors and movement system. In Fire Season this changes smoke exposure, assistance and firefighting, which affect injuries, village integrity and the outcome. Fire-reactive boids provide a visible response in the same scene.')
add('<b>Beta example:</b> if a second fire makes an assigned refuge unsafe, the active evacuation now rechecks destination safety and reachability when the world changes, discards the invalid target and chooses a reachable safe refuge. If none exists, the villager reports that no safe route is available. Exhausted movement retries no longer count as arrival; safety timing requires physical arrival outside the danger threshold.')
heading('2. Release notes - changes since Assignment 4')
add('<b>Playable crowd scaling.</b> Sandbox presets restart with 8, 16, 32 or 64 real residents, each with behavior, needs, relationships, memory and navigation. DetourCrowd capacity is 64. Presets fix seed 5, 40 birds and local planning for repeatable comparisons. Normal Fire Season remains at eight residents. Reports over 32 agents stay local to respect the server schema.')
add('<b>Reclaim land.</b> Up to three volunteers travel to the eastern boundary and contribute 36 worker-seconds of physical construction. Completion grows the playable map from 60 x 40 m to 80 x 40 m: <b>800 m² more usable land (+33.3%)</b>. TileCache blockers are removed without replacing live crowd agents. Placement bounds, planner reports and command validation unlock three meadow refuges together. Residents visit, socialize and evacuate there; the player can place wells, food, rocks and fires. The camera reframes the larger map. Needs, emergencies, rain and danger near the site interrupt work; pause/resume preserves progress.')
add('<b>Rain shower.</b> A 25-second Sandbox event adds animated rain, low-poly clouds and dimmer lighting. The same weather state weakens fires by 1.4 HP/s, suppresses spread and pauses construction; a 60-second cooldown prevents immediate reuse. Weather follows simulation speed and pause. These additions preserve Fire Season rules and reset with each fresh world.')
add('<b>Measurement tools.</b> Ten-second browser captures follow a three-second warm-up and export FPS, p95 frame/simulation time, draw calls and resolution. Active-game captures record changing obstacle counts. An opt-in headless sweep exercises four populations, two flock sizes and three seeds with real WASM navigation, 20 rocks and a fire.')
add('<b>Correctness and presentation.</b> Added regressions for newly unsafe targets, unreachable refuges, false arrival after stuck recovery and unsafe arrival positions. Above 16 residents, only the selected name/speech label is shown; the scrollable inspector still selects every resident. Path diagnostics default off. Default birds are now 40. Help text correctly states that fires near houses cause triple integrity damage.')
heading('3. Core loop and demo')
add('<b>Start:</b> choose Fire Season or Sandbox and planner. <b>Active:</b> manage escalating fires with water, food and the bell, or experiment with construction, weather and crowd sizes in Sandbox. <b>End:</b> survive four simulated minutes for victory, or lose at zero integrity / three injured residents; inspect results, replay or return to the menu. Sandbox has an explicit session end.')
story.append(PageBreak())
add('<b>Living Village - Beta validation and production plan</b>', 'title')
heading('4. Validation and measured performance')
add('<b>49 frontend tests passed</b> (two optional tests skipped); the earlier <b>18 backend tests passed</b> with fake model responses. Type checking, production export and public deployment passed. Five new tests cover construction, unlocked navigation/refuges, interruptions, reset and weather. Browser checks confirmed construction completion, a well placed on new land, EastMeadow evacuation and rain. Earlier loop/replay checks and three-seed bot wins/losses still pass in the suite. Manual browser victory and human playtesting remain outstanding.')
table([
    ['<b>Earlier production samples (before new events)</b>', '<b>Mean FPS</b>', '<b>p95 frame</b>', '<b>p95 sim/frame</b>'],
    ['Nov 9: 8 residents, 40 birds, active fire/nav updates', '60.0', '21.1 ms', '0.80 ms'],
    ['Earlier scaling pass: 16 residents / 40 birds', '60.0', '19.0 ms', '0.50 ms'],
    ['Earlier scaling pass: 32 residents / 40 birds', '57.3', '25.3 ms', '0.80 ms'],
    ['Earlier scaling pass: 64 residents / 40 birds', '36.9', '39.5 ms', '1.70 ms'],
], [288,70,84,90])
add('Windows, Intel i7-8550U, Chromium 156; 698 x 474 canvas, DPR 1, 1x speed, spatial grid; 10-second samples. The Nov 9 run had 600 frames, 75-76 obstacles and zero frames over 33 ms. Crowd samples were morning routines with paths on, before label culling. These are historical measurements, not benchmarks of rain or the expanded map; those need fresh captures. Evidence: docs/benchmarks and docs/scaling-notes.md.', 'small')
add('The eight-resident sample achieved the recorded 60 FPS average, but p95 exceeded the 16.7 ms budget. Sustained 60 FPS is not established for larger crowds or the new events. The original Assignment 2 brief is absent; its 8-resident / 40-bird / runtime-navigation target is quoted in the Assignment 3 report.', 'small')
heading('5. Updated schedule (Weeks 10-15)')
table([
    ['<b>Week / status</b>', '<b>Engineering and evaluation</b>', '<b>Visuals / milestone</b>'],
    ['10 | Nov 2-8<br/>Delivered', 'Real crowd presets and repeatable browser/CPU benchmarks. Instancing and min-cost flow deferred.', 'Retain procedural village; establish measured crowd limits.'],
    ['11 | Nov 9-15<br/>Beta delivered', 'Safe-arrival fixes, playable land reclamation, three new refuges and rain event; 49 tests and public deployment.', 'Label culling, construction progress, rain/clouds, camera reframing; updated report.'],
    ['12 | Nov 16-22<br/>Planned', 'Human playtest, browser victory and expanded-map/rain benchmarks; smoke-aware routes and planner fallback.', 'Improve danger feedback and crowd readability from feedback.'],
    ['13 | Nov 23-29<br/>Planned', 'Controlled safety scenarios, balance and larger-viewport performance; optimize measured bottlenecks.', 'Review accessibility and visual consistency.'],
    ['14 | Nov 30-Dec 6<br/>Planned', 'Feature freeze, full regression and release-candidate benchmark.', 'Final screenshots and demo recording.'],
    ['15 | Dec 7-13<br/>Buffer', 'Bug fixes, documentation and final submission preparation; no new features.', 'Polish and final report.'],
], [106,268,158])
heading('6. Known issues and scope decisions')
add('Routes avoid fire footprints but do not price smoke exposure along the full path. Refuge assignments are not global occupancy management. Expansion is one designed meadow, not infinite terrain or a construction economy; homes and population stay unchanged. Larger crowds repeat guard roles and incur high draw counts; 64 remains a stress case.')
add('An in-flight planner disconnect can drop that request while reflexes continue. Human playtesting is outstanding. Rigged characters, audio, a Fire Season victory-rain transition, floods/storms, min-cost flow, vector memory and a model cascade remain deferred. Sandbox rain is shipped; the broader roadmap and feature freeze are not complete.')

def footer(canvas, doc):
    canvas.setFont(FACE, 8)
    canvas.setFillColor(colors.HexColor('#666666'))
    canvas.drawString(40, 24, 'Group JJ | Living Village | Assignment 5')
    canvas.drawRightString(572, 24, f'{doc.page} / 2')

doc = SimpleDocTemplate(str(OUT), pagesize=(612,792), leftMargin=40, rightMargin=40, topMargin=34, bottomMargin=40,
                        title='Living Village - Assignment 5: Beta Build', author='Group JJ: Harjeet Singh Chahal and Isha Nimesh Shah')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
