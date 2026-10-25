// Voiceover for the demo video, one line per scene in scripts/record-demo.ts.
// Each scene is held on screen for as long as its line takes to say.
// Numbers that can change between runs stay in the captions, not here.
export const NARRATION: Record<string, string> = {
  title:
    "Meet Maya. She's a freelance designer who also drives deliveries to make ends meet.",
  maya:
    "Some weeks she earns over a thousand dollars. Some weeks, nothing. And she's carrying about nine thousand dollars of debt.",
  safe:
    "Every debt app tells her the same thing: pay the highest-interest card first. But her real question is, how much can I pay without missing rent next week? DebtPilot simulates two thousand versions of her next two months, and finds the most she can safely pay today.",
  why:
    "Paying everything would actually cost her more. In almost half of those futures, she'd miss a payment, and late fees would eat the savings.",
  life:
    "Then life happens. Maya loses her delivery gig for three weeks. She just tells DebtPilot, in plain words.",
  replanned:
    "Claude understands she still has her design income, and the planner cuts her payment. Keeping the old plan would have meant more than a fifty percent chance of missing rent.",
  asks:
    "And it doesn't just change her plan. It asks first, and explains why, in plain language.",
  approved: "Nothing moves without her yes, and every step is on the record.",
  sixMonth: "Let's start a six-month test in the background.",
  outage: "Now, real systems fail. Let's take the credit bureau offline.",
  safeMode:
    "The agent retries, then keeps going with the last good data, in safe mode. It can lower payments, but never raise them on stale data. That rule lives in the code, not just in the prompt.",
  restored: "When the feed comes back, it re-syncs, and re-plans on fresh data.",
  proof:
    "Here's the proof. Across two hundred simulated half-years, DebtPilot had the lowest expected cost. A fixed rule, like keeping a thousand-dollar buffer, only works if you guess right. When Maya lost her gig, that rule's chance of a missed payment tripled.",
  end: "Claude decides. Code does the math. And nothing moves without your OK. I'm Dorian, and I built DebtPilot solo at Cal Hacks.",
};
