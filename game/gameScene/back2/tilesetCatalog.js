export const CATALOG = [
  { id:"desk1", frame:{x:0,y:72,w:16,h:24},  platforms:[{x:0, y:8,  w:16, h:7}], z:2 },
  { id:"desk2", frame:{x:16,y:96,w:32,h:16}, platforms:[{x:0, y:0,  w:32, h:7}], z:2 },
  { id:"desk3", frame:{x:66,y:48,w:44,h:16}, platforms:[{x:0, y:0,  w:44, h:2}], z:2 },

  { id:"chair1", frame:{x:67,y:74,w:11,h:22}, platforms:[{x:0, y:11, w:11, h:4}], z:2 },
  { id:"chair2", frame:{x:82,y:74,w:11,h:22}, platforms:[{x:0, y:11, w:11, h:4}], z:2 },
  { id:"chair3", frame:{x:98,y:74,w:11,h:22}, platforms:[{x:0, y:11, w:11, h:4}], overlay:{x:0,y:0,w:12,h:15}, z:3 },

  { id:"door",    frame:{x:64,y:0,w:16,h:32}, z:1 },
  { id:"artwork", frame:{x:81,y:1,w:29,h:14}, z:1 },
  { id:"memo",    frame:{x:81,y:17,w:30,h:14}, z:1 },
  { id:"window1", frame:{x:49,y:97,w:14,h:14}, z:1 },
  { id:"window2", frame:{x:65,y:97,w:30,h:14}, z:1 },
  { id:"window3", frame:{x:96,y:97,w:16,h:14}, z:1 },
  { id:"shelf1",  frame:{x:17,y:64,w:30,h:32}, z:2 },
  { id:"shelf2",  frame:{x:49,y:64,w:14,h:32}, z:2 },

  // 배경 타일
  { id:"bg_core",  frame:{x:16,y:11,w:32,h:42}, z:0 },
  { id:"bg_left",  frame:{x:47,y:11,w:8,h:42},  z:0 },
  { id:"bg_right", frame:{x:9, y:11,w:8,h:42},  z:0 },
];

export const PICK_WEIGHTS = {
  desk1:1, desk2:1, desk3:1.2,
  chair1:1, chair2:1, chair3:1,
  door:.4, artwork:.6, memo:.6,
  window1:.6, window2:.8, window3:.6,
  shelf1:.7, shelf2:.7,
};
