// 2025–26 season snapshot — used as a fallback when live ESPN rosters can't be loaded,
// and to supply trade-value ratings (and salaries ESPN doesn't list) by player name.
// Salaries are approximate cap hits in $M; "v" is a 0–100
// trade-value rating (talent + age + contract) used only to grade trades.
// Edit freely — the app reads everything from this file.
window.NBA_DATA = {
  season: "2025–26",
  // Simplified 2025–26 CBA numbers used for salary matching (in $M)
  cba: { tierLow: 8.527, tierHigh: 33.115, flatAdd: 8.527, pctHigh: 1.25, cushion: 0.25 },
  teams: {
    ATL: { espn: "1", city: "Atlanta", name: "Hawks", color: "#E03A3E", players: [
      ["Trae Young","PG",46.0,86],["Jalen Johnson","F",30.0,84],["Kristaps Porziņģis","C",30.7,79],
      ["Dyson Daniels","G",6.1,81],["Onyeka Okongwu","C",15.0,76],["Zaccharie Risacher","F",13.7,73],
      ["Nickeil Alexander-Walker","G",14.3,72],["Luke Kennard","G",11.0,67]]},
    BOS: { espn: "2", city: "Boston", name: "Celtics", color: "#007A33", players: [
      ["Jayson Tatum","F",54.1,90],["Jaylen Brown","G/F",53.1,85],["Derrick White","G",28.1,80],
      ["Anfernee Simons","G",27.7,73],["Payton Pritchard","G",7.2,76],["Sam Hauser","F",10.0,67],
      ["Neemias Queta","C",2.3,66],["Jordan Walsh","F",2.2,63]]},
    BKN: { espn: "17", city: "Brooklyn", name: "Nets", color: "#1F1F1F", players: [
      ["Michael Porter Jr.","F",38.3,77],["Cam Thomas","G",6.0,73],["Nic Claxton","C",25.4,72],
      ["Egor Dëmin","G",6.1,68],["Terance Mann","G",15.5,65],["Day'Ron Sharpe","C",6.3,65],
      ["Noah Clowney","F",3.2,64],["Ziaire Williams","F",6.0,63]]},
    CHA: { espn: "30", city: "Charlotte", name: "Hornets", color: "#1D1160", players: [
      ["LaMelo Ball","PG",37.96,83],["Brandon Miller","F",11.4,80],["Kon Knueppel","G",8.8,76],
      ["Miles Bridges","F",24.9,74],["Collin Sexton","G",19.0,71],["Grant Williams","F",13.0,64],
      ["Josh Green","G",13.9,63]]},
    CHI: { espn: "4", city: "Chicago", name: "Bulls", color: "#CE1141", players: [
      ["Josh Giddey","G",25.0,77],["Coby White","G",12.9,76],["Matas Buzelis","F",4.8,74],
      ["Nikola Vučević","C",21.5,72],["Ayo Dosunmu","G",7.5,68],["Kevin Huerter","G",18.0,66],
      ["Tre Jones","G",8.0,66],["Isaac Okoro","F",11.0,64],["Patrick Williams","F",18.0,64]]},
    CLE: { espn: "5", city: "Cleveland", name: "Cavaliers", color: "#860038", players: [
      ["Donovan Mitchell","G",46.4,89],["Evan Mobley","F/C",46.4,86],["Darius Garland","G",39.4,81],
      ["Jarrett Allen","C",20.0,78],["De'Andre Hunter","F",23.3,71],["Max Strus","G/F",15.9,68],
      ["Lonzo Ball","G",10.0,66],["Sam Merrill","G",8.2,64]]},
    DAL: { espn: "6", city: "Dallas", name: "Mavericks", color: "#00538C", players: [
      ["Anthony Davis","F/C",54.1,86],["Kyrie Irving","G",36.6,84],["Cooper Flagg","F",13.8,83],
      ["Dereck Lively II","C",5.0,74],["P.J. Washington","F",14.9,72],["Daniel Gafford","C",14.4,72],
      ["Klay Thompson","G",16.7,67],["Naji Marshall","F",9.0,68],["Max Christie","G",7.7,67],
      ["D'Angelo Russell","G",5.7,66]]},
    DEN: { espn: "7", city: "Denver", name: "Nuggets", color: "#0E2240", players: [
      ["Nikola Jokić","C",55.2,98],["Jamal Murray","G",46.4,84],["Aaron Gordon","F",22.8,77],
      ["Christian Braun","G",4.2,76],["Cameron Johnson","F",22.5,74],["Jonas Valančiūnas","C",10.4,68],
      ["Peyton Watson","F",4.4,68],["Tim Hardaway Jr.","G",3.3,63],["Bruce Brown","G",1.3,63]]},
    DET: { espn: "8", city: "Detroit", name: "Pistons", color: "#C8102E", players: [
      ["Cade Cunningham","G",46.4,90],["Jalen Duren","C",6.5,76],["Ausar Thompson","F",8.8,76],
      ["Jaden Ivey","G",10.1,73],["Tobias Harris","F",26.6,70],["Isaiah Stewart","C",15.0,68],
      ["Duncan Robinson","F",16.0,67],["Caris LeVert","G",14.1,65]]},
    GSW: { espn: "9", city: "Golden State", name: "Warriors", color: "#1D428A", players: [
      ["Stephen Curry","G",59.6,92],["Jimmy Butler","F",54.1,82],["Draymond Green","F",25.9,74],
      ["Jonathan Kuminga","F",22.5,73],["Brandin Podziemski","G",3.7,72],["Buddy Hield","G",9.2,67],
      ["Al Horford","C",5.7,67],["Moses Moody","G",12.0,66],["De'Anthony Melton","G",3.0,65]]},
    HOU: { espn: "10", city: "Houston", name: "Rockets", color: "#CE1141", players: [
      ["Kevin Durant","F",54.7,89],["Alperen Şengün","C",33.9,86],["Amen Thompson","F",10.8,85],
      ["Jabari Smith Jr.","F",25.4,76],["Fred VanVleet","G",44.9,74],["Tari Eason","F",5.6,73],
      ["Reed Sheppard","G",7.4,70],["Steven Adams","C",18.1,67],["Dorian Finney-Smith","F",12.7,66],
      ["Clint Capela","C",7.2,65]]},
    IND: { espn: "11", city: "Indiana", name: "Pacers", color: "#002D62", players: [
      ["Tyrese Haliburton","G",45.6,87],["Pascal Siakam","F",45.6,83],["Andrew Nembhard","G",18.0,74],
      ["Bennedict Mathurin","G",9.2,71],["Aaron Nesmith","F",11.0,70],["T.J. McConnell","G",11.0,66],
      ["Obi Toppin","F",15.0,66],["Jarace Walker","F",6.7,66]]},
    LAC: { espn: "12", city: "LA", name: "Clippers", color: "#C8102E", players: [
      ["Kawhi Leonard","F",50.0,86],["James Harden","G",36.2,83],["Ivica Zubac","C",18.1,80],
      ["John Collins","F",26.6,73],["Bradley Beal","G",5.4,69],["Brook Lopez","C",8.8,68],
      ["Chris Paul","G",2.3,67],["Bogdan Bogdanović","G",16.0,66],["Derrick Jones Jr.","F",10.0,67],
      ["Kris Dunn","G",5.7,66]]},
    LAL: { espn: "13", city: "Los Angeles", name: "Lakers", color: "#552583", players: [
      ["Luka Dončić","G",46.0,96],["LeBron James","F",52.6,85],["Austin Reaves","G",13.9,81],
      ["Deandre Ayton","C",8.1,72],["Rui Hachimura","F",18.3,70],["Marcus Smart","G",5.0,67],
      ["Jake LaRavia","F",6.0,65],["Jarred Vanderbilt","F",11.6,63],["Gabe Vincent","G",11.5,62],
      ["Dalton Knecht","G",4.0,62]]},
    MEM: { espn: "29", city: "Memphis", name: "Grizzlies", color: "#5D76A9", players: [
      ["Ja Morant","G",39.4,83],["Jaren Jackson Jr.","F/C",34.0,84],["Zach Edey","C",6.5,75],
      ["Jaylen Wells","F",2.0,72],["Cedric Coward","G/F",3.9,70],["Santi Aldama","F",17.9,70],
      ["Ty Jerome","G",9.4,70],["Kentavious Caldwell-Pope","G",21.6,67],["Vince Williams Jr.","G",5.6,66],
      ["Brandon Clarke","F",12.5,65]]},
    MIA: { espn: "14", city: "Miami", name: "Heat", color: "#98002E", players: [
      ["Bam Adebayo","C",37.1,82],["Tyler Herro","G",31.0,80],["Norman Powell","G",20.5,75],
      ["Kel'el Ware","C",4.4,74],["Andrew Wiggins","F",28.2,72],["Jaime Jaquez Jr.","F",3.9,69],
      ["Davion Mitchell","G",12.0,68],["Nikola Jović","F",4.4,68]]},
    MIL: { espn: "15", city: "Milwaukee", name: "Bucks", color: "#00471B", players: [
      ["Giannis Antetokounmpo","F",54.1,94],["Myles Turner","C",25.0,76],["Kevin Porter Jr.","G",2.2,70],
      ["Bobby Portis","F",13.4,69],["Kyle Kuzma","F",22.4,67],["Gary Trent Jr.","G",3.2,66],
      ["Cole Anthony","G",2.3,64],["AJ Green","G",2.3,64]]},
    MIN: { espn: "16", city: "Minnesota", name: "Timberwolves", color: "#0C2340", players: [
      ["Anthony Edwards","G",45.6,92],["Julius Randle","F",33.3,78],["Rudy Gobert","C",35.0,78],
      ["Jaden McDaniels","F",26.0,76],["Naz Reid","C",25.0,75],["Donte DiVincenzo","G",11.7,70],
      ["Mike Conley","G",10.8,65],["Rob Dillingham","G",6.3,64],["Terrence Shannon Jr.","G",2.5,63]]},
    NOP: { espn: "3", city: "New Orleans", name: "Pelicans", color: "#0C2340", players: [
      ["Zion Williamson","F",39.4,80],["Trey Murphy III","F",25.0,79],["Herbert Jones","F",13.9,75],
      ["Dejounte Murray","G",30.0,73],["Jordan Poole","G",34.0,69],["Derik Queen","C",4.4,69],
      ["Jeremiah Fears","G",5.0,68],["Yves Missi","C",3.0,67],["Saddiq Bey","F",6.1,64],
      ["Kevon Looney","C",8.0,63]]},
    NYK: { espn: "18", city: "New York", name: "Knicks", color: "#006BB6", players: [
      ["Jalen Brunson","G",34.9,90],["Karl-Anthony Towns","C",53.1,85],["OG Anunoby","F",39.6,80],
      ["Mikal Bridges","F",24.9,79],["Josh Hart","G",19.1,76],["Mitchell Robinson","C",12.9,71],
      ["Miles McBride","G",4.7,68],["Jordan Clarkson","G",3.6,66],["Guerschon Yabusele","F",5.5,66]]},
    OKC: { espn: "25", city: "Oklahoma City", name: "Thunder", color: "#007AC1", players: [
      ["Shai Gilgeous-Alexander","G",38.3,97],["Jalen Williams","F",4.8,87],["Chet Holmgren","C",13.7,85],
      ["Isaiah Hartenstein","C",28.5,75],["Alex Caruso","G",18.1,74],["Cason Wallace","G",5.6,74],
      ["Luguentz Dort","G",17.7,73],["Ajay Mitchell","G",2.2,69],["Aaron Wiggins","G",10.5,68],
      ["Isaiah Joe","G",11.0,68]]},
    ORL: { espn: "19", city: "Orlando", name: "Magic", color: "#0077C0", players: [
      ["Paolo Banchero","F",15.3,87],["Franz Wagner","F",38.7,85],["Desmond Bane","G",36.7,80],
      ["Jalen Suggs","G",30.3,76],["Anthony Black","G",5.8,70],["Wendell Carter Jr.","C",18.1,70],
      ["Tyus Jones","G",7.0,66],["Goga Bitadze","C",8.4,65],["Jonathan Isaac","F",15.0,65]]},
    PHI: { espn: "20", city: "Philadelphia", name: "76ers", color: "#006BB6", players: [
      ["Tyrese Maxey","G",38.7,86],["Joel Embiid","C",55.0,85],["VJ Edgecombe","G",10.6,77],
      ["Paul George","F",51.7,75],["Jared McCain","G",4.2,71],["Quentin Grimes","G",8.7,71],
      ["Kelly Oubre Jr.","F",8.4,69],["Andre Drummond","C",5.0,63]]},
    PHX: { espn: "21", city: "Phoenix", name: "Suns", color: "#1D1160", players: [
      ["Devin Booker","G",53.1,88],["Jalen Green","G",33.3,75],["Mark Williams","C",6.3,72],
      ["Dillon Brooks","F",21.1,69],["Grayson Allen","G",16.9,67],["Ryan Dunn","F",2.6,66],
      ["Collin Gillespie","G",2.0,66],["Royce O'Neale","F",9.4,65],["Nick Richards","C",5.0,63]]},
    POR: { espn: "22", city: "Portland", name: "Trail Blazers", color: "#E03A3E", players: [
      ["Deni Avdija","F",15.0,80],["Damian Lillard","G",14.0,78],["Jrue Holiday","G",32.4,75],
      ["Shaedon Sharpe","G",6.6,74],["Donovan Clingan","C",7.1,74],["Toumani Camara","F",2.0,74],
      ["Scoot Henderson","G",10.5,70],["Jerami Grant","F",32.0,68],["Matisse Thybulle","G",11.6,62]]},
    SAC: { espn: "23", city: "Sacramento", name: "Kings", color: "#5A2D81", players: [
      ["Domantas Sabonis","C",42.3,84],["Zach LaVine","G",47.5,77],["DeMar DeRozan","F",24.6,76],
      ["Keegan Murray","F",11.1,74],["Malik Monk","G",18.8,71],["Russell Westbrook","G",2.3,67],
      ["Dennis Schröder","G",14.1,67],["Keon Ellis","G",2.3,67],["Dario Šarić","F",5.4,60]]},
    SAS: { espn: "24", city: "San Antonio", name: "Spurs", color: "#8A939A", players: [
      ["Victor Wembanyama","C",13.4,96],["De'Aaron Fox","G",37.1,83],["Stephon Castle","G",9.1,79],
      ["Dylan Harper","G",11.0,77],["Devin Vassell","G",27.6,72],["Keldon Johnson","F",17.5,69],
      ["Harrison Barnes","F",19.0,67],["Jeremy Sochan","F",7.0,67],["Luke Kornet","C",10.0,66],
      ["Kelly Olynyk","C",13.4,63]]},
    TOR: { espn: "28", city: "Toronto", name: "Raptors", color: "#CE1141", players: [
      ["Scottie Barnes","F",38.7,85],["Brandon Ingram","F",38.1,78],["RJ Barrett","G/F",27.7,74],
      ["Jakob Poeltl","C",19.5,74],["Immanuel Quickley","G",32.5,73],["Collin Murray-Boyles","F",5.0,68],
      ["Gradey Dick","G",4.8,67],["Jamal Shead","G",2.0,65],["Ochai Agbaji","G",6.4,64]]},
    UTA: { espn: "26", city: "Utah", name: "Jazz", color: "#002B5C", players: [
      ["Lauri Markkanen","F",46.4,80],["Walker Kessler","C",4.9,76],["Keyonte George","G",4.1,73],
      ["Ace Bailey","F",8.6,73],["Isaiah Collier","G",2.5,66],["Jusuf Nurkić","C",19.4,66],
      ["Kyle Filipowski","F",2.5,66],["Brice Sensabaugh","F",4.0,65],["Cody Williams","F",5.5,62]]},
    WAS: { espn: "27", city: "Washington", name: "Wizards", color: "#002B5C", players: [
      ["Alex Sarr","C",12.0,74],["CJ McCollum","G",30.7,71],["Kyshawn George","F",2.9,71],
      ["Tre Johnson","G",8.2,71],["Bilal Coulibaly","F",8.3,70],["Khris Middleton","F",33.3,66],
      ["Bub Carrington","G",4.1,66],["Corey Kispert","F",15.0,64],["Cam Whitmore","F",3.4,64],
      ["Marvin Bagley III","F",2.9,63]]},
  },
};
