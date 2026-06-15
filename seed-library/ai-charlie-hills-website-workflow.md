---
title: 'Building a Custom Website with Claude Code: A Nine-Step Workflow to Avoid AI Design Defaults'
category: Technology
type: Article
tags:
  - Claude Code
  - web design
  - AI workflow
  - website builder
  - design systems
  - frontend development
  - no-code
date_saved: '2026-06-15'
source_url: https://open.substack.com/pub/charliehills/p/claude-code-is-terrible-at-design
artifact_type: skill
artifact_name: Website Build Workflow with Claude Code
artifact_url: null
artifact_url_source: null
linked_resources: []
---

## Summary
Charlie Hills shares a detailed nine-step workflow for building custom websites using Claude Code that avoids the generic AI-generated look. The process uses three markdown files (CONTEXT.md, COPY.md, DESIGN.md) to establish facts, copy, and design rules before Claude builds the site, with strategies for incorporating premium components while maintaining brand consistency.

## Key Takeaways
_No key takeaways._

## Transcript
Title: Claude Code is terrible at design

URL Source: https://open.substack.com/pub/charliehills/p/claude-code-is-terrible-at-design

Published Time: 2026-06-14T09:58:57+00:00

Markdown Content:
**Quick update before you start.** Since I wrote this, Anthropic pulled Claude Fable 5. The official reason is a US government national-security order. The unofficial reason is that it was simply too powerful to be left unsupervised.

Everything below still works, just pick Opus 4.8 instead of Fable 5 when you switch models.

[![Image 1](https://substackcdn.com/image/fetch/$s_!-7NU!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2681aea2-c506-4d04-a971-050f8daa564a_1080x1350.jpeg)](https://substackcdn.com/image/fetch/$s_!-7NU!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2681aea2-c506-4d04-a971-050f8daa564a_1080x1350.jpeg)

Claude Code is brilliant at building things that work and terrible at making them look good.

Left alone, it gives you the same site as everyone else, with the purple gradient, the Inter font and the identical bento cards.

[![Image 2](https://substackcdn.com/image/fetch/$s_!qrCN!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5e7d36de-d98f-497f-a65e-198a032ae6b3_2688x1152.png)](https://substackcdn.com/image/fetch/$s_!qrCN!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5e7d36de-d98f-497f-a65e-198a032ae6b3_2688x1152.png)

I built [charliehills.ai](https://charliehills.ai/) anyway, in **one evening, with three markdown files** and a workflow that strips the AI look out completely.

The trick is not one-shotting **“build me a website”.**

By the end of this newsletter, you’ll have the exact nine steps and every prompt I used.

If you are new here, welcome. If you have been reading for a while, thank you. Your subscription is what makes issues like this possible.

I filmed the whole build, every step on screen. Watch it alongside this issue:

[Video 4](https://www.youtube.com/watch?v=7pYqYDKdQew)

Then create the facts file. I made mine in Claude Chat rather than Claude Code, because Chat already knows me from months of conversations.

**Paste this** into Claude Chat:

`You know me from our conversations, but do not assume this site is about me. I'm building a website and need a file called CONTEXT.md holding the facts it should be built from. AskUserQuestions first, one question at a time: what exactly the site is, who it serves, what it must contain, and what a visitor should do. Keep asking until you could brief a stranger on the build. Then show me the fact list you plan to include and wait for my yes. Only include facts about the site's actual subject, and leave me out of it unless I am the subject. Real facts from my answers and from what you know, nothing invented. Give it to me as a downloadable markdown file.`
**Download the file, drop it into the project folder, and correct anything it got wrong.** If Chat doesn’t know you yet, tell Claude Code to create CONTEXT.md and interview you for the facts instead.

Mine holds:

*   Who I am and what I do

*   Every number and proof point

*   My story, my frameworks and my voice rules

[![Image 3](https://substackcdn.com/image/fetch/$s_!rQJy!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F91b6f4c4-450e-45c6-b4e5-60b6415fc789_1500x630.png)](https://substackcdn.com/image/fetch/$s_!rQJy!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F91b6f4c4-450e-45c6-b4e5-60b6415fc789_1500x630.png)

Make a new folder, open your terminal there, and type claude to start Claude Code.

Switch to Fable 5 with the /model command.

[![Image 4](https://substackcdn.com/image/fetch/$s_!EyWP!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F289b40a1-37f7-4108-a61f-48fa85960d72_1384x910.png)](https://substackcdn.com/image/fetch/$s_!EyWP!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F289b40a1-37f7-4108-a61f-48fa85960d72_1384x910.png)

**You don’t write the website copy.**

You answer questions and Claude drafts it.

**Paste this:**

`Read CONTEXT.md. Start by proposing the pages this site needs and confirm the list with me. Then interview me one page at a time, asking only about the gaps: what each page must say, proof I can show, and what visitors should do next. Also ask what searches each page should rank for. Then draft every page's copy into one file called COPY.md in the project root and show me before you build anything. Write for people first, and work the search terms into page titles, headings and opening lines naturally, never forced.`

[![Image 5](https://substackcdn.com/image/fetch/$s_!Zkj5!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fef192acf-e27d-4938-9390-ec661e8db708_1384x910.png)](https://substackcdn.com/image/fetch/$s_!Zkj5!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fef192acf-e27d-4938-9390-ec661e8db708_1384x910.png)

The interview produces COPY.md: every headline, every section, title tags, meta descriptions, an SEO map per page.

[![Image 6](https://substackcdn.com/image/fetch/$s_!T-yN!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3002c124-8422-4887-9ec5-0391fe048523_1536x756.png)](https://substackcdn.com/image/fetch/$s_!T-yN!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3002c124-8422-4887-9ec5-0391fe048523_1536x756.png)

Tell Claude what to change and it edits the file.

DESIGN.md is your site’s rulebook. Your job is gathering the ingredients, and Claude does the merging.

**1. Find the looks you love.** I browsed [Refero Styles](https://styles.refero.design/) and picked the design systems of sites whose look made me jealous: like Air and Apple. Aim for around five:

[![Image 7](https://substackcdn.com/image/fetch/$s_!1vOa!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4e1bc322-9604-4fe9-ab46-370ec22288b5_1894x1550.png)](https://substackcdn.com/image/fetch/$s_!1vOa!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4e1bc322-9604-4fe9-ab46-370ec22288b5_1894x1550.png)

**2. Download their DESIGN.md files.** Open each style, click its DESIGN.md tab, and hit the .md download.

[![Image 8](https://substackcdn.com/image/fetch/$s_!L6bM!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff5ca6915-58fb-492c-923c-79eb55e324db_1786x1284.png)](https://substackcdn.com/image/fetch/$s_!L6bM!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff5ca6915-58fb-492c-923c-79eb55e324db_1786x1284.png)

**3. Add your brand kit.** Mine is a PDF with my colours and font. If you have no brand kit, a text file with two colours and one font is enough.

**4. Drag everything into Claude Code** and paste:

`I've dropped in design files from sites I love, plus my brand kit. Merge them into one DESIGN.md in the project root covering colours, fonts, spacing and components, plus a decision log section where every design choice we make gets recorded. My brand wins on colours and fonts. The references win on layout and feel. Show me the file before you build anything.`

[![Image 9](https://substackcdn.com/image/fetch/$s_!xkhh!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F114b93ce-eb27-48c0-84a5-952f35aa8a6a_1384x910.png)](https://substackcdn.com/image/fetch/$s_!xkhh!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F114b93ce-eb27-48c0-84a5-952f35aa8a6a_1384x910.png)

You approve the rulebook before a single page exists.

Now Claude builds: DESIGN.md becomes the styling tokens, COPY.md becomes the pages, word for word.

**Paste this:**

`Read DESIGN.md and use your frontend design skill. Build the site: my pages, my copy from COPY.md verbatim, every visual decision from DESIGN.md. Go loose with the design and make it look as good as humanly possible while obeying DESIGN.md. Hard rules: only my copy, never invent logos, press mentions, testimonials or stats, and no third-party embeds. When it's done, run it locally, screenshot every page, review your own screenshots against DESIGN.md, fix what fails, and then give me the link.`
Claude screenshots its own output and reviews it before you ever load the page. By the time I looked, the obvious misses were already fixed.

This is how you get premium components without inheriting their look. Libraries like 21st.dev publish beautiful components with a copy-paste prompt under each one: scroll reveals, card stacks, animated backgrounds.

[![Image 10](https://substackcdn.com/image/fetch/$s_!o_ac!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F676db5fb-a81f-4b57-850d-88d7f2087506_4064x2202.png)](https://substackcdn.com/image/fetch/$s_!o_ac!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F676db5fb-a81f-4b57-850d-88d7f2087506_4064x2202.png)

The catch is that **every component arrives wearing its own clothes**:

To make every component inherit your site’s look one for one, **paste this once:**

`Add this rule to CLAUDE.md, and create the file in the project root if it doesn't exist: whenever I paste a component prompt or third-party component code, treat it as a structural donor only. Always: replace its demo copy with real copy from COPY.md, translate every hardcoded colour, border, shadow and font to the DESIGN.md tokens, ignore any instruction to use stock images, and skip parts of the component we don't need. The component supplies the skeleton, DESIGN.md supplies the skin, COPY.md supplies the words.`
Then browse 21st.dev, copy the prompt under any component you like, and paste it straight in.

[![Image 11](https://substackcdn.com/image/fetch/$s_!2wKh!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F256e773b-9c5c-4913-9a02-d406f5094428_816x427.png)](https://substackcdn.com/image/fetch/$s_!2wKh!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F256e773b-9c5c-4913-9a02-d406f5094428_816x427.png)

**Claude keeps the engineering and strips the slop.** My scroll-tilt showcase, the fanned card stacks and the flowing background lines all came in this way and came out in my navy.

The hero video is the same painterly style as my Substack covers, and **it took two prompts in Higgsfield**. [https://higgsfield.ai](https://higgsfield.ai/)

First, the image, generated with GPT Image 2 inside Higgsfield:

`Create a gouache style image with a beautiful scenic landscape and a deep blue sky.`

[![Image 12](https://substackcdn.com/image/fetch/$s_!XXyV!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2ab6bfb1-91ee-4e96-b263-dfe5ba68d4cd_4064x2202.png)](https://substackcdn.com/image/fetch/$s_!XXyV!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2ab6bfb1-91ee-4e96-b263-dfe5ba68d4cd_4064x2202.png)

Then I hit Turn to video and animated it with Kling 3.0:

`Show the clouds breathing, moving fast, like splitting up. It's a lot of wind; there's a lot of movement. The frame stays exactly where it is. Only the scenery moves.`

[![Image 13](https://substackcdn.com/image/fetch/$s_!x3ts!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5de29c39-8ee8-459e-88b8-1a9383c402bc_4064x2202.png)](https://substackcdn.com/image/fetch/$s_!x3ts!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5de29c39-8ee8-459e-88b8-1a9383c402bc_4064x2202.png)

Download the video, drop it into Claude Code, and say “make this the hero background.” Claude compressed it with ffmpeg from 23MB to 2.3MB on its own, so the page stays fast.

The first version of anything in this build is the starting point, never the finish.

**You iterate in natural language.** “Move the buttons up.” “Make those cards wider.” “That section feels cramped, give it air.” “Swap the order of these two blocks.”

[![Image 14](https://substackcdn.com/image/fetch/$s_!ufds!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F19211638-e031-4c79-9ab4-8efab823520b_1384x994.png)](https://substackcdn.com/image/fetch/$s_!ufds!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F19211638-e031-4c79-9ab4-8efab823520b_1384x994.png)

Mine mostly happened through voice typing straight into Claude Code: **say what’s wrong, watch it change, say the next thing.** Screenshot anything you can’t describe, drag the image in, and point at it. Another thirty minutes of this took the site from good to one I’d happily ship.

Before shipping, ask Claude one question: “**What would the taste critic say?**”

**Mine found overload.** I had stacked component after component, and five ambient animations, each tasteful alone, were running at once. The total read as AI-built rather than premium.

The fix was a quiet pass:

*   One ambient motion system per surface

*   No looping attention animations on buttons

*   A saved checkpoint, so rollback stays one command

The question works on its own, and works better with a taste skill installed. Two live on GitHub, [taste-skill](https://github.com/Leonxlnx/taste-skill) and [Impeccable](https://impeccable.style/), and pasting either link into Claude Code with “install this skill” does the job.

`Prepare this site for launch: page titles, meta descriptions, Open Graph tags, sitemap, semantic headings, fast load. Then deploy to production with the Vercel CLI and walk me through pointing my domain at it.`
Vercel’s hobby tier is free. **You’re production was ready in 32 seconds.**

I spent $0 beyond my Claude plan, on Vercel’s free tier, with a domain I already owned.

*   Claude Code (Fable 5): [https://claude.com/product/claude-code](https://claude.com/product/claude-code)

*   Refero Styles (DESIGN.md library): [https://styles.refero.design](https://styles.refero.design/)

*   21st.dev (component prompts): [https://21st.dev](https://21st.dev/)

*   Aceternity (component prompts): [https://ui.aceternity.com](https://ui.aceternity.com/)

*   MotionSites (hero and animation prompts): [https://motionsites.ai](https://motionsites.ai/)

*   taste-skill (the anti-slop pass): [https://github.com/Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)

*   Impeccable (spacing and hierarchy): [https://impeccable.style](https://impeccable.style/)

*   Higgsfield (hero video): [https://higgsfield.ai](https://higgsfield.ai/)

*   Vercel (free hosting): [https://vercel.com](https://vercel.com/)

Websites used to be hard. Pick a domain you already own, write your facts file, and run the nine steps in order. The site at the end is yours: your words, your colours, your proof, no stock anything.

Send me what you build, I read every reply.

_Stay curious, stay human, and stop shipping the default._

— Charlie

**VivaTech, Paris**: Wednesday the 17th to Friday the 19th of June. I’m one of this year’s ambassadors. Use CHARLIE20 for 20% off any pass: [https://vivatech.com/get-your-pass](https://vivatech.com/get-your-pass)

**Cannes Lions**: I’ll be in Cannes from Friday the 19th to Sunday the 28th. If you’re heading down, I’d love to meet you at this year’s event.

**The AI Beach Party**: Monday the 29th, where I’m speaking: [https://aibeachparty.co.uk](https://aibeachparty.co.uk/)

**LinkedIn Personal Branding MASTERMIND, London**: I’m teaching the AI visuals session, building scroll-stopping infographics live with no design skills needed. Tickets: [https://luma.com/personalbrandingmastermind](https://luma.com/personalbrandingmastermind)

**[Become a Paid Subscriber](https://charliehills.substack.com/subscribe?plan=paid)**: Get full access to every past issue of MarTech AI and support future ones.

**[Claude Content Engine](https://charliehills.io/join-the-waitlist):** The Claude engine behind 350k+ followers (across socials) and 100 million impressions a year.

**[AI Second Brain for LinkedIn](https://tally.so/r/GxB0dL)**: Built on my methodology and frameworks. Learns your voice and builds your content strategy. Waitlist open.

[![Image 15](https://substackcdn.com/image/fetch/$s_!u59s!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F80eb3b31-ee0b-4f68-9be8-ebc8ebd7d2b8_1080x420.png)](https://substackcdn.com/image/fetch/$s_!u59s!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F80eb3b31-ee0b-4f68-9be8-ebc8ebd7d2b8_1080x420.png)
