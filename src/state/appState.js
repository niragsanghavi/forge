// ── PINS ──────────────────────────────────────────────────────────────────
window.SUPER_PIN = 'FORGE2026';
window.ADMIN_PIN = '9090';

// ── CONSTANTS ─────────────────────────────────────────────────────────────
window.COMMON_WORKOUTS = [
  "Gym","Padel","Walk","Run","Yoga","Volleyball","Cricket","Swimming",
  "Cycling","Pickleball","Pilates","Football","Basketball","Badminton",
  "Weight training","Cardio","HIIT","Strength training","Zumba","Boxing",
  "Stretching","Hiking","Dance","Rowing","Spinning","Tennis","Crossfit"
];

window.TWIST_LIBRARY = [
  {
    id:'boss_week',
    name:'Boss Week',
    desc:'One week targets double, streak bonuses triple',
    config:'Which week? (1-4)',
    configKey:'week',
    configDefault:3
  },
  {
    id:'double_points_day',
    name:'Double Points Day',
    desc:'One day per week earns 4x base points',
    config:'Which day? (1=Mon, 7=Sun)',
    configKey:'day',
    configDefault:3
  },
  {
    id:'comeback_bonus',
    name:'Comeback Bonus',
    desc:'Players with 0 logs last week get 2x points for first 3 days of next week',
    config:null
  },
  {
    id:'bonus_workout',
    name:'Bonus Workout Type',
    desc:'A specific workout earns +3 pts instead of +2 this month',
    config:'Which workout?',
    configKey:'workout',
    configDefault:'Run'
  },
  {
    id:'elimination',
    name:'Elimination Round',
    desc:'Lowest scorer each week loses streak bonus for following week',
    config:null
  },
  {
    id:'stakes_mode',
    name:'Stakes Mode',
    desc:'Losing team covers next month for the whole group',
    config:null
  }
];

// ── SHARED STATE ──────────────────────────────────────────────────────────
window.me = null;
window.groupData = null;
window.groupCode = null;
window.allLogs = [];
window.bonus30 = [];
window.flags = [];
window.activeTwists = {};
window.selDay = null;
window.selW = [];
window.adminUnlocked = false;
window.unsub = [];