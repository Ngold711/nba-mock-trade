// All-time position pools for the Tier List Maker: curated legends plus active greats at their true primary
// position (25–28 each, no one in two lists). Names resolve against the full NBA/ABA/BAA directory, so every
// entry carries its archive id and official NBA.com headshot. Editorial: one primary position per player.
export const ALLTIME = {
  PG: ["Magic Johnson", "Stephen Curry", "Oscar Robertson", "John Stockton", "Isiah Thomas", "Chris Paul", "Steve Nash", "Jason Kidd", "Bob Cousy", "Jerry West",
    "Russell Westbrook", "Allen Iverson", "Gary Payton", "Walt Frazier", "Damian Lillard", "Kyrie Irving", "Tony Parker", "Lenny Wilkens", "Tiny Archibald",
    "Shai Gilgeous-Alexander", "Luka Doncic", "Chauncey Billups", "Kevin Johnson", "Tim Hardaway", "Derrick Rose", "Dennis Johnson", "Mark Price", "Jalen Brunson"],
  SG: ["Michael Jordan", "Kobe Bryant", "Dwyane Wade", "James Harden", "Clyde Drexler", "Reggie Miller", "Ray Allen", "George Gervin", "Earl Monroe", "Sam Jones",
    "Klay Thompson", "Devin Booker", "Anthony Edwards", "Hal Greer", "Pete Maravich", "Manu Ginobili", "Vince Carter", "Tracy McGrady", "Sidney Moncrief",
    "Joe Dumars", "Paul Westphal", "David Thompson", "Bill Sharman", "Mitch Richmond", "Donovan Mitchell", "Dave Bing"],
  SF: ["LeBron James", "Larry Bird", "Kevin Durant", "Julius Erving", "Elgin Baylor", "Scottie Pippen", "Kawhi Leonard", "John Havlicek", "Rick Barry",
    "Dominique Wilkins", "James Worthy", "Paul Pierce", "Carmelo Anthony", "Jayson Tatum", "Paul Arizin", "Billy Cunningham", "Grant Hill", "Alex English",
    "Bernard King", "Adrian Dantley", "Jimmy Butler", "Paul George", "Chris Mullin", "Jamaal Wilkes", "Connie Hawkins"],
  PF: ["Tim Duncan", "Karl Malone", "Kevin Garnett", "Dirk Nowitzki", "Charles Barkley", "Giannis Antetokounmpo", "Bob Pettit", "Kevin McHale", "Elvin Hayes",
    "Dennis Rodman", "Pau Gasol", "Anthony Davis", "Chris Webber", "Dolph Schayes", "Jerry Lucas", "Dave DeBusschere", "Chris Bosh", "Bob McAdoo",
    "Rasheed Wallace", "Amar'e Stoudemire", "Blake Griffin", "Shawn Kemp", "Draymond Green", "Tom Heinsohn", "Spencer Haywood"],
  C: ["Kareem Abdul-Jabbar", "Bill Russell", "Wilt Chamberlain", "Shaquille O'Neal", "Hakeem Olajuwon", "Moses Malone", "David Robinson", "Patrick Ewing",
    "Nikola Jokic", "George Mikan", "Bill Walton", "Willis Reed", "Dave Cowens", "Joel Embiid", "Robert Parish", "Nate Thurmond", "Wes Unseld",
    "Dikembe Mutombo", "Alonzo Mourning", "Dwight Howard", "Yao Ming", "Artis Gilmore", "Walt Bellamy", "Victor Wembanyama", "Ben Wallace"],
};

/**
 * Resolve the curated names against the player directory (service/directory.js buildDirectory rows).
 * Namesakes (Patrick Ewing Sr./Jr., Gary Payton / Gary Payton II) go to the Hall of Famer / Top 75 honoree,
 * then the longer career. → { PG: [{ id, name, headshot, alt, years, active, team }], … , missing: [names] }
 */
export function resolveAllTime(directory, matchKey) {
  const by = new Map();
  for (const p of directory || []) { const k = matchKey(p.name); by.set(k, [...(by.get(k) || []), p]); }
  const pick = (list) => [...list].sort((a, b) => (b.hof || b.top75 ? 1 : 0) - (a.hof || a.top75 ? 1 : 0) || ((b.to || 0) - (b.from || 0)) - ((a.to || 0) - (a.from || 0)))[0];
  const out = { missing: [] }, used = new Set();
  for (const [slot, names] of Object.entries(ALLTIME)) {
    out[slot] = [];
    for (const n of names) {
      const hit = by.get(matchKey(n));
      if (!hit) { out.missing.push(n); continue; }
      const p = pick(hit);
      if (used.has(p.id)) continue;
      used.add(p.id);
      out[slot].push({ id: p.id, name: p.name, headshot: p.headshot || null, alt: p.alt || null, years: p.years || "", active: !!p.active, team: p.team || "" });
    }
  }
  return out;
}
