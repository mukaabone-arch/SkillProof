// Seeds the interview-prep question bank (data only — no session/scoring
// logic; see InterviewQuestion's own doc comment in schema.prisma).
// Run from apps/api:  npx ts-node prisma/seed-interview-questions.ts
//
// expectedElements below is a STAR-shaped illustrative reference point per
// question, NOT a checklist — see schema.prisma's InterviewQuestion doc
// comment. It is stored verbatim as the `star` object on each entry.
//
// INDUSTRY_AWARENESS questions are deliberately evergreen: they ask about
// reasoning and how a candidate stays current, never about a specific
// current event, tool, or trend by name — those date badly, and scoring
// an answer against a dated example would end up rewarding a candidate
// for reciting stale material rather than for sound reasoning.
import { InterviewQuestionCategory, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Star {
  situation: string;
  task: string;
  action: string;
  result: string;
}

interface SeedQuestion {
  category: InterviewQuestionCategory;
  text: string;
  whatToLookFor: string;
  star: Star;
}

const QUESTIONS: SeedQuestion[] = [
  // ---------- PROBLEM_SOLVING (5) ----------
  {
    category: 'PROBLEM_SOLVING',
    text: 'Tell me about a time a project drastically changed direction at the last minute. How did you adjust?',
    whatToLookFor: 'Agility, emotional control, structured pivoting without panic.',
    star: {
      situation: 'Client shift or regulatory change',
      task: 'Re-evaluate goals and scrap prior work',
      action: 'Paused to assess new requirements, reallocated resources, communicated transparently',
      result: 'Delivered on new timeline with minimal disruption',
    },
  },
  {
    category: 'PROBLEM_SOLVING',
    text: 'Describe a time you faced an obstacle when you lacked sufficient resources. What was your approach?',
    whatToLookFor: 'Resourcefulness, creativity, lateral thinking.',
    star: {
      situation: 'Budget cuts or short staffing',
      task: 'Complete high-stakes task under constraint',
      action: 'Cross-trained staff, open-source tools, automated manual steps',
      result: 'Met objectives ahead of schedule, saved cost',
    },
  },
  {
    category: 'PROBLEM_SOLVING',
    text: 'Describe a time you had to make an important decision without having all the information you wanted.',
    whatToLookFor: 'Decisiveness, risk assessment, sound judgment under uncertainty.',
    star: {
      situation: 'Incomplete data on a time-sensitive call',
      task: 'Decide and move forward anyway',
      action: 'Weighed available evidence, consulted a trusted colleague, set a fallback plan',
      result: 'Decision held up, adjusted only a minor detail later',
    },
  },
  {
    category: 'PROBLEM_SOLVING',
    text: "Tell me about the most complex problem you've had to solve. Walk me through your process.",
    whatToLookFor: 'Analytical rigor, structured breakdown, follow-through.',
    star: {
      situation: 'Multi-layered technical or process issue with no obvious cause',
      task: 'Isolate the root cause and fix it durably',
      action: 'Broke the problem into smaller pieces, tested hypotheses one at a time, documented findings',
      result: 'Found and fixed the root cause, prevented recurrence',
    },
  },
  {
    category: 'PROBLEM_SOLVING',
    text: "Describe a time a solution you implemented didn't work as expected. What did you do next?",
    whatToLookFor: 'Humility, iteration, ownership of failure.',
    star: {
      situation: "A fix that didn't hold up in production or practice",
      task: "Correct course without losing the team's confidence",
      action: 'Diagnosed why it failed, rolled back safely, tried a revised approach',
      result: 'Second attempt succeeded, learned a lesson applied since',
    },
  },

  // ---------- CONFLICT (4) ----------
  {
    category: 'CONFLICT',
    text: 'Tell me about a time you had a conflict with a coworker. How did you handle it?',
    whatToLookFor: 'Professionalism, active listening, resolution over winning.',
    star: {
      situation: 'Clash over ownership or work styles',
      task: 'Overcome friction without compromising the project',
      action: 'Private neutral discussion, listened first',
      result: 'Compromise blending both ideas, improved team dynamics',
    },
  },
  {
    category: 'CONFLICT',
    text: 'Tell me about a time you disagreed with a decision made by your manager.',
    whatToLookFor: 'Candor, respect for hierarchy, constructive dissent.',
    star: {
      situation: 'A directive you believed was the wrong call',
      task: 'Voice disagreement without undermining the decision',
      action: 'Requested a private conversation, presented the reasoning and data, asked clarifying questions',
      result: 'Manager reconsidered part of it, or you committed fully once the decision stood',
    },
  },
  {
    category: 'CONFLICT',
    text: 'Describe a situation where you had to give a colleague difficult feedback.',
    whatToLookFor: 'Directness, empathy, focus on behavior not character.',
    star: {
      situation: 'Repeated performance or behavior issue affecting the team',
      task: 'Deliver the message without damaging the relationship',
      action: 'Chose a private setting, focused on specific behavior and impact, offered to help',
      result: 'Behavior improved, trust was maintained',
    },
  },
  {
    category: 'CONFLICT',
    text: 'Tell me about a time you had to work with someone whose working style was very different from yours.',
    whatToLookFor: 'Adaptability, patience, focus on shared goals.',
    star: {
      situation: 'Mismatched pace or communication style on a shared deliverable',
      task: 'Keep the work moving despite friction',
      action: 'Adjusted own habits, agreed on shared checkpoints, communicated more explicitly',
      result: 'Delivered together, working relationship improved over time',
    },
  },

  // ---------- TEAMWORK (4) ----------
  {
    category: 'TEAMWORK',
    text: 'Give an example of when you had to persuade a peer or manager to accept an idea they resisted.',
    whatToLookFor: 'Influence, data-backed reasoning, empathy.',
    star: {
      situation: 'New workflow met skepticism',
      task: 'Gain buy-in from decision-makers',
      action: 'Gathered case studies, built prototype, presented ROI',
      result: 'Approved, implemented, adopted department-wide',
    },
  },
  {
    category: 'TEAMWORK',
    text: "Describe a time you had to rely heavily on a team to accomplish a goal you couldn't reach alone.",
    whatToLookFor: 'Collaboration, trust, shared credit.',
    star: {
      situation: 'A goal too large or cross-functional for one person',
      task: 'Deliver as a team on a tight deadline',
      action: "Clarified roles, leaned on others' expertise, checked in regularly",
      result: 'Goal met, team felt ownership of the result',
    },
  },
  {
    category: 'TEAMWORK',
    text: 'Tell me about a time you had to onboard or mentor someone new to the team.',
    whatToLookFor: "Patience, communication, investment in others' growth.",
    star: {
      situation: 'A new hire or teammate unfamiliar with the work',
      task: 'Get them productive quickly without slowing yourself down',
      action: 'Paired on early tasks, wrote down tribal knowledge, checked in on blockers',
      result: 'New teammate ramped faster than usual, knowledge became reusable',
    },
  },
  {
    category: 'TEAMWORK',
    text: 'Describe a time your team missed a goal. How did you respond?',
    whatToLookFor: 'Accountability, no blame-shifting, forward focus.',
    star: {
      situation: 'A shared deliverable that fell short or slipped',
      task: 'Keep morale and momentum intact',
      action: 'Ran a blameless retro, identified real causes, agreed on concrete changes',
      result: "Next cycle's goal was hit, team trusted the process more",
    },
  },

  // ---------- INITIATIVE (4) ----------
  {
    category: 'INITIATIVE',
    text: 'Describe a time you saw a recurring problem at work and took the initiative to fix it without being asked.',
    whatToLookFor: 'Proactivity, long-term thinking, ownership.',
    star: {
      situation: 'Broken internal process or bottleneck',
      task: "Fix something technically someone else's job",
      action: 'Researched solutions, created an SOP, rolled it out',
      result: 'Saved weekly manual hours, reduced errors',
    },
  },
  {
    category: 'INITIATIVE',
    text: 'Tell me about a time you took on responsibility outside your job description.',
    whatToLookFor: 'Ownership, initiative, comfort with ambiguity.',
    star: {
      situation: 'A gap nobody was formally covering',
      task: 'Keep something important from falling through',
      action: 'Volunteered, learned what was needed quickly, kept stakeholders informed',
      result: 'Gap was covered, responsibility sometimes became permanent',
    },
  },
  {
    category: 'INITIATIVE',
    text: "Describe a time you proposed a new idea or project that wasn't asked for.",
    whatToLookFor: 'Vision, initiative, ability to sell an idea.',
    star: {
      situation: "An opportunity you noticed that wasn't on anyone's roadmap",
      task: 'Get leadership to take the idea seriously',
      action: 'Built a small proof of concept, framed it around business impact, pitched it informally first',
      result: 'Idea was greenlit or piloted',
    },
  },
  {
    category: 'INITIATIVE',
    text: 'Tell me about a time you automated or simplified something that used to be done manually.',
    whatToLookFor: 'Efficiency mindset, technical initiative, follow-through.',
    star: {
      situation: 'A repetitive manual task consuming real time',
      task: 'Free up that time without breaking anything',
      action: 'Scripted or templated the repetitive parts, tested against real cases, rolled it out gradually',
      result: 'Time reclaimed, fewer manual errors going forward',
    },
  },

  // ---------- MOTIVATION (4) ----------
  {
    category: 'MOTIVATION',
    text: 'Tell me about a time you felt unmotivated at work. What did you do to push through?',
    whatToLookFor: 'Self-awareness, intrinsic motivation, resilience.',
    star: {
      situation: 'Repetitive tasks or project stagnation',
      task: 'Maintain quality output without excitement',
      action: 'Broke work into smaller goals, connected task to larger impact',
      result: 'Completed on time, rediscovered purpose',
    },
  },
  {
    category: 'MOTIVATION',
    text: 'Describe a time you had to complete a task you found boring or beneath your skill level.',
    whatToLookFor: 'Professionalism, work ethic, perspective.',
    star: {
      situation: 'A low-challenge but necessary task',
      task: 'Finish it to the same standard as more interesting work',
      action: 'Reframed why it mattered, timeboxed it, looked for a small way to improve it',
      result: 'Delivered on time and quality, sometimes improved the task itself',
    },
  },
  {
    category: 'MOTIVATION',
    text: "Tell me about a time you didn't get a promotion, raise, or opportunity you expected. How did you react?",
    whatToLookFor: 'Maturity, resilience, constructive response to setback.',
    star: {
      situation: 'A passed-over opportunity',
      task: 'Stay engaged and effective afterward',
      action: 'Asked for specific feedback, made a plan to close the gap, kept contributing at full effort',
      result: 'Grew into the next opportunity when it came',
    },
  },
  {
    category: 'MOTIVATION',
    text: 'Describe what keeps you motivated on a long project with no immediate payoff.',
    whatToLookFor: 'Intrinsic motivation, long-term focus, self-management.',
    star: {
      situation: 'A multi-month effort with a distant finish line',
      task: 'Sustain effort and quality throughout',
      action: 'Set intermediate milestones, tracked visible progress, connected daily work to the end goal',
      result: 'Stayed engaged and delivered at the same quality on day 100 as day 1',
    },
  },

  // ---------- SELF_AWARENESS (5) ----------
  {
    category: 'SELF_AWARENESS',
    text: "What's a weakness you've actively worked to improve? What did you do about it?",
    whatToLookFor: 'Honesty, self-improvement, concrete action over platitudes.',
    star: {
      situation: 'A real, specific limitation affecting your work',
      task: 'Improve it rather than just naming it',
      action: 'Sought feedback, practiced deliberately, tracked progress over time',
      result: 'Measurable improvement, still an active area of growth',
    },
  },
  {
    category: 'SELF_AWARENESS',
    text: 'Tell me about a time you received critical feedback that was hard to hear.',
    whatToLookFor: 'Openness, non-defensiveness, ability to act on feedback.',
    star: {
      situation: 'Unexpected or blunt feedback on your work or behavior',
      task: 'Respond productively instead of defensively',
      action: 'Paused before reacting, asked questions to understand it fully, made a change',
      result: 'Relationship and work both improved afterward',
    },
  },
  {
    category: 'SELF_AWARENESS',
    text: 'Describe a mistake you made that had a real impact. How did you handle it?',
    whatToLookFor: 'Accountability, transparency, learning orientation.',
    star: {
      situation: 'An error that affected a deliverable, teammate, or customer',
      task: 'Own the mistake and limit the damage',
      action: 'Disclosed it immediately, fixed what could be fixed, explained what happened',
      result: 'Trust was preserved, safeguard added to prevent repeats',
    },
  },
  {
    category: 'SELF_AWARENESS',
    text: 'How do you decide when to ask for help versus figuring something out yourself?',
    whatToLookFor: "Judgment, self-awareness of limits, efficient use of others' time.",
    star: {
      situation: 'A task where the right call was not obvious',
      task: 'Avoid wasting time without over-relying on others',
      action: 'Set a time-box for independent effort, defined what "stuck" looked like, asked a focused question when needed',
      result: 'Resolved efficiently, developed a reusable rule of thumb',
    },
  },
  {
    category: 'SELF_AWARENESS',
    text: 'Tell me about a time your first instinct on how to solve something turned out to be wrong.',
    whatToLookFor: 'Intellectual humility, adaptability, willingness to change course.',
    star: {
      situation: 'An initial approach that seemed obviously right',
      task: 'Recognize and correct the wrong turn early',
      action: 'Noticed contradicting evidence, tested the assumption directly, changed approach before much was lost',
      result: 'Better approach found, habit of testing assumptions earlier since',
    },
  },

  // ---------- AMBITION (4) ----------
  {
    category: 'AMBITION',
    text: 'Where do you want to be in your career in the next few years, and what are you doing now to get there?',
    whatToLookFor: 'Direction, realistic planning, present-day action.',
    star: {
      situation: "A career direction you've chosen deliberately",
      task: 'Build toward it while still excelling in the current role',
      action: 'Identified the skills/experience needed, sought stretch assignments, invested time outside core duties',
      result: 'Measurable progress toward that direction already visible',
    },
  },
  {
    category: 'AMBITION',
    text: 'Tell me about a goal you set for yourself that was a real stretch. How did it go?',
    whatToLookFor: 'Ambition, planning, resilience under a hard target.',
    star: {
      situation: 'A goal noticeably above your comfort zone',
      task: 'Actually make meaningful progress on it',
      action: 'Broke it into milestones, sought input from people further along, adjusted the plan as you learned',
      result: 'Hit the goal or came close enough to call it a clear win',
    },
  },
  {
    category: 'AMBITION',
    text: 'What kind of work energizes you most, and how do you seek more of it?',
    whatToLookFor: 'Self-knowledge, initiative in shaping own role, genuine engagement.',
    star: {
      situation: 'Work that consistently produced your best output and energy',
      task: 'Get more of that kind of work without abandoning current duties',
      action: 'Identified the pattern deliberately, volunteered for adjacent projects, discussed it openly with a manager',
      result: 'Role gradually shifted toward more of that work',
    },
  },
  {
    category: 'AMBITION',
    text: "Describe a time you took on a stretch role or project before you felt fully ready.",
    whatToLookFor: 'Courage, growth mindset, comfort with being uncomfortable.',
    star: {
      situation: 'An opportunity that exceeded your current experience level',
      task: 'Deliver credibly despite the gap',
      action: "Said yes deliberately, over-prepared going in, leaned on mentors for the parts you didn't know",
      result: 'Delivered successfully, grew faster than a safer choice would have allowed',
    },
  },

  // ---------- INDUSTRY_AWARENESS (5, evergreen — reasoning/habits, never current events) ----------
  {
    category: 'INDUSTRY_AWARENESS',
    text: 'How do you stay current in a field that changes as fast as this one?',
    whatToLookFor: 'Intellectual curiosity, deliberate learning habits, discernment about sources.',
    star: {
      situation: 'A fast-moving domain where standing still means falling behind',
      task: 'Keep working knowledge genuinely current, not just superficially aware',
      action: 'Built a regular habit of reading and hands-on experimentation, curated a small set of trusted sources, tested new ideas on real problems',
      result: 'Knowledge stays applied and current rather than theoretical',
    },
  },
  {
    category: 'INDUSTRY_AWARENESS',
    text: 'How do you decide which new tools, methods, or trends are worth adopting versus ignoring as hype?',
    whatToLookFor: 'Critical thinking, evidence-based evaluation, resistance to fads.',
    star: {
      situation: 'A constant stream of new tools and techniques claiming to be essential',
      task: 'Avoid both chasing every trend and missing genuinely useful ones',
      action: 'Evaluated against a real problem first, looked for independent evidence beyond marketing, ran a small trial before committing',
      result: 'Adopted a few tools that stuck, avoided wasted effort on the rest',
    },
  },
  {
    category: 'INDUSTRY_AWARENESS',
    text: 'Tell me about a time your understanding of best practice in your field turned out to be outdated.',
    whatToLookFor: 'Humility, continuous learning, willingness to unlearn.',
    star: {
      situation: "A practice you'd relied on that the field had since moved past",
      task: 'Update your approach without a track record of doing things "the old way"',
      action: 'Noticed the gap through a peer, a failure, or new material, investigated why the field had moved on, deliberately retrained the habit',
      result: 'Adopted the updated approach and kept a habit of periodically re-checking assumptions',
    },
  },
  {
    category: 'INDUSTRY_AWARENESS',
    text: "How do you approach learning a skill or domain that's completely new to you?",
    whatToLookFor: 'Structured learning approach, self-direction, applied practice over passive study.',
    star: {
      situation: 'An unfamiliar domain suddenly relevant to your work',
      task: 'Become genuinely competent, not just conversational',
      action: 'Identified foundational concepts first, learned by building something small and real, sought feedback from someone more experienced',
      result: 'Reached working competence fast enough to contribute meaningfully',
    },
  },
  {
    category: 'INDUSTRY_AWARENESS',
    text: "What's your process for evaluating whether a claim or result in your field is actually credible?",
    whatToLookFor: 'Skepticism, rigor, resistance to hype cycles.',
    star: {
      situation: 'An impressive-sounding claim or result circulating in the field',
      task: 'Decide whether to trust and act on it',
      action: 'Checked the methodology and evidence behind the claim, looked for independent replication or counterexamples, tested it against a real case where possible',
      result: 'Formed a calibrated view instead of taking the claim at face value',
    },
  },

  // ---------- CULTURE_FIT (5) ----------
  {
    category: 'CULTURE_FIT',
    text: 'What kind of team environment brings out your best work?',
    whatToLookFor: 'Self-awareness, alignment with collaborative norms, honesty over generic answers.',
    star: {
      situation: "Reflecting on environments where you've done your best and worst work",
      task: 'Articulate a genuine preference, not a generic answer',
      action: 'Compared past teams and roles honestly, identified the specific conditions that mattered, distinguished nice-to-have from need-to-have',
      result: 'A clear, specific, honest description of what helps you thrive',
    },
  },
  {
    category: 'CULTURE_FIT',
    text: "Tell me about a company or team value that you personally hold yourself to, even when no one's watching.",
    whatToLookFor: 'Integrity, intrinsic values, consistency between words and actions.',
    star: {
      situation: 'A situation with no accountability or oversight in the moment',
      task: 'Act consistently with your values anyway',
      action: 'Did the more effortful or honest thing when the easier option was available and unlikely to be noticed',
      result: 'Maintained the standard, and it became a habit rather than a one-off',
    },
  },
  {
    category: 'CULTURE_FIT',
    text: 'Describe a time you had to adapt to a company culture very different from what you were used to.',
    whatToLookFor: 'Adaptability, open-mindedness, respect for different norms.',
    star: {
      situation: 'A new environment with unfamiliar norms or pace',
      task: 'Become effective without resisting the culture',
      action: 'Observed before acting, asked questions instead of assuming, adjusted communication style and expectations',
      result: 'Became a trusted, effective member of the new environment',
    },
  },
  {
    category: 'CULTURE_FIT',
    text: "How do you handle working somewhere that moves faster (or slower) than you're used to?",
    whatToLookFor: 'Flexibility, self-management, calibration to context.',
    star: {
      situation: "A pace mismatch between your habits and the environment's",
      task: 'Stay effective without burning out or under-delivering',
      action: 'Recalibrated expectations deliberately, adjusted personal workflow and check-in cadence, communicated proactively about pace',
      result: 'Maintained quality and sustainable pace in the new environment',
    },
  },
  {
    category: 'CULTURE_FIT',
    text: 'What does accountability look like to you in a workplace?',
    whatToLookFor: 'Ownership mindset, maturity, concrete rather than abstract answer.',
    star: {
      situation: 'Reflecting on what "being accountable" actually means day to day',
      task: 'Give a concrete, lived definition rather than a buzzword',
      action: 'Grounded the answer in a real past situation where you took or saw real accountability, distinguished it from blame, connected it to trust',
      result: 'A specific, credible personal definition rather than a rehearsed platitude',
    },
  },

  // ---------- COMMUNICATION (5) ----------
  {
    category: 'COMMUNICATION',
    text: 'Tell me about a time you had to explain something technical to a non-technical audience.',
    whatToLookFor: 'Clarity, empathy for the audience, ability to simplify without dumbing down.',
    star: {
      situation: 'A technical concept a non-technical stakeholder needed to understand',
      task: 'Get genuine understanding, not just polite nodding',
      action: "Used analogies grounded in their world, checked understanding along the way, avoided unnecessary jargon",
      result: 'Stakeholder could explain it back accurately and made an informed decision',
    },
  },
  {
    category: 'COMMUNICATION',
    text: 'Describe a time a message you sent or said was misunderstood. What did you do?',
    whatToLookFor: 'Self-awareness, responsiveness, clarity under correction.',
    star: {
      situation: 'A message that landed differently than intended',
      task: 'Repair the misunderstanding before it caused real damage',
      action: 'Noticed the disconnect quickly, clarified directly rather than assuming it would resolve itself, adjusted future communication style',
      result: 'Relationship and understanding were repaired, adjusted communication habits going forward',
    },
  },
  {
    category: 'COMMUNICATION',
    text: 'Tell me about a time you had to deliver bad news to a stakeholder or customer.',
    whatToLookFor: 'Honesty, composure, solution orientation.',
    star: {
      situation: 'A delay, failure, or disappointing result that had to be communicated',
      task: 'Preserve trust while delivering unwelcome news',
      action: 'Communicated early rather than waiting, was direct about the facts, came with a plan or next steps rather than just the problem',
      result: 'Trust was preserved despite the bad news',
    },
  },
  {
    category: 'COMMUNICATION',
    text: 'Describe a time you had to communicate across a significant language or cultural barrier.',
    whatToLookFor: 'Patience, adaptability, extra care in clarity.',
    star: {
      situation: 'A collaboration where language or cultural context created real friction',
      task: 'Ensure nothing important was lost in translation',
      action: 'Slowed down and simplified language, used written follow-ups to confirm understanding, asked for things to be repeated back',
      result: 'Collaboration succeeded with no critical misunderstandings',
    },
  },
  {
    category: 'COMMUNICATION',
    text: 'Tell me about a time you had to write something (a doc, an email, a proposal) that a lot of people would read and act on.',
    whatToLookFor: 'Precision, audience awareness, ownership of clarity.',
    star: {
      situation: 'A high-stakes piece of writing with a wide or important audience',
      task: 'Make sure it was correctly understood and acted on',
      action: 'Structured it for skimmability, had it reviewed before sending, anticipated likely questions and answered them in advance',
      result: 'Readers understood and acted on it correctly with minimal follow-up clarification',
    },
  },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const q of QUESTIONS) {
    const existing = await prisma.interviewQuestion.findFirst({
      where: { text: q.text, category: q.category },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.interviewQuestion.create({
      data: {
        category: q.category,
        text: q.text,
        whatToLookFor: q.whatToLookFor,
        expectedElements: q.star as unknown as object,
        followUpProbes: [],
        isCompanyGrounded: false,
        active: true,
      },
    });
    created++;
  }

  console.log(`Seeded ${created} interview question(s), skipped ${skipped} already present.`);
  console.log(`Bank total intended: ${QUESTIONS.length} questions across ${new Set(QUESTIONS.map((q) => q.category)).size} categories.`);
}

main().finally(() => prisma.$disconnect());
