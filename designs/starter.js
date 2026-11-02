// starter.js - a small design to learn the format from: a battery-powered night light.
// A battery pack through a switch and a 5 V regulator feeds an Arduino Nano, which reads a push button and a light
// sensor and dims an LED. The README builds this file step by step; copy it to start your own.
design({
  "name": "Night light (starter)",
  "status": "an example to copy",
  "about": `# Night light - the starter design

A small example of the design file: a 4 x AA battery pack, an on/off switch and a 5 V regulator feed an
**Arduino Nano**, which reads a **push button** and a **light sensor** and dims an **LED**.

Everything on this page comes from **designs/starter.js**. Open it in a text editor next to this page: change a
colour or move a box, save, and the page redraws by itself.

**Try:** click the **LED**, then **Trace to battery**. Click the 220 ohm resistor on its wire.`,

  // the drawing area, and the regions the parts sit in (left to right)
  "canvas": { "w": 1800, "h": 1000 },
  "zones": [
    { "id": "power", "name": "POWER", "note": "battery, switch, regulator", "x0": 0, "x1": 600 },
    { "id": "brain", "name": "CONTROLLER", "note": "the Arduino", "x0": 600, "x1": 1200 },
    { "id": "io", "name": "INPUTS AND OUTPUTS", "note": "button, light sensor, LED", "x0": 1200, "x1": 1800 }
  ],

  // what a wire of each category carries (shown in the wire's panel)
  "volts": { "raw": "6 V: the battery pack, after the switch", "logic": "5 V from the regulator", "gnd": "0 V (ground)", "sig": "5 V logic" },

  "parts": [
    { "id": "battery", "name": "Battery pack", "what": "Four AA cells in a holder: about 6 V.", "pn": "4 x AA holder with leads",
      "zone": "power", "box": [70, 380, 150, 260], "fill": "#E63946", "sys": ["power"], "source": true,
      "pins": [
        ["PLUS", "+ (red lead)", "plus"],
        ["MINUS", "- (black lead)", "minus"]
      ] },
    { "id": "switch", "name": "On/off switch", "what": "Cuts the battery's + to everything.", "pn": "SPDT slide switch",
      "zone": "power", "box": [300, 170, 220, 110], "fill": "#F4A261", "sys": ["power"],
      "pins": [
        ["IN", "in: the battery's +"],
        ["OUT", "out: on to the regulator"]
      ],
      "links": [
        ["feed", "IN", "OUT", "through the switch, while it is on"]
      ] },
    { "id": "reg", "name": "5 V regulator", "what": "Turns the battery's 6 V into a steady 5 V for the Arduino and the sensors.", "pn": "5 V step-down regulator, 500 mA",
      "zone": "power", "box": [300, 430, 220, 170], "fill": "#F6BD60", "sys": ["power"],
      "pins": [
        ["VIN", "VIN: from the switch", "pwr"],
        ["GND", "GND", "gnd"],
        ["VOUT", "VOUT: 5 V out"]
      ],
      "links": [
        ["feed", "VIN", "VOUT", "through the regulator"]
      ] },
    { "id": "nano", "name": "Arduino Nano", "what": "The brain: reads the button and the light sensor, dims the LED.", "pn": "Arduino Nano (or a clone)",
      "zone": "brain", "box": [700, 330, 320, 330], "fill": "#22577A", "sys": [], "mcu": true,
      "pins": [
        ["V5", "5V: power in", "pwr"],
        ["GND", "GND", "gnd"],
        ["D2", "D2: the button"],
        ["D9", "D9: the LED (PWM)"],
        ["A0", "A0: the light sensor"]
      ] },
    { "id": "button", "name": "Push button", "what": "Press to switch the light on or off.", "pn": "6 mm tactile button",
      "zone": "io", "box": [1330, 150, 220, 110], "fill": "#9BC53D", "sys": ["sensors"],
      "pins": [
        ["A", "one leg: 5 V", "pwr"],
        ["B", "the other leg: D2"]
      ] },
    { "id": "ldr", "name": "Light sensor", "what": "A light-dependent resistor: its resistance falls as the room gets brighter.", "pn": "LDR, 5 mm",
      "zone": "io", "box": [1330, 410, 220, 110], "fill": "#9BC53D", "sys": ["sensors"],
      "pins": [
        ["A", "one leg: 5 V", "pwr"],
        ["B", "the other leg: A0"]
      ] },
    { "id": "led", "name": "LED", "what": "The light itself.", "pn": "5 mm warm white LED",
      "zone": "io", "box": [1330, 670, 220, 110], "fill": "#FFD60A", "sys": ["leds"],
      "pins": [
        ["ANODE", "+ (the long leg)"],
        ["CATHODE", "- (the short leg)", "gnd"]
      ] }
  ],

  // junctions: several wires joined in one place. "star": true marks the ground point every ground is traced to;
  // "bar": true draws a bus wire (a bar) instead of a dot
  "splices": [
    { "id": "v5", "name": "5 V", "what": "The regulator's 5 V shared out: the Arduino, the button and the light sensor.",
      "zone": "power", "box": [560, 500, 40, 40], "lab": "5 V", "lp": "r" },
    { "id": "gnd", "name": "Ground", "what": "The one ground point: every ground wire ends here.",
      "zone": "power", "box": [120, 860, 520, 22], "bar": true, "lab": "Ground - the ground point", "star": true }
  ],

  // resistors (R), capacitors (CN ceramic, CE electrolytic with its + on end a) and jumpers (J)
  "comps": [
    { "ref": "R1", "kind": "R", "value": "220 Ω", "job": "LED resistor", "part": "the LED's resistor",
      "why": "so the LED takes about 15 mA from D9", "where": "at the Arduino's D9 pin, in line",
      "a": "nano.D9", "b": "led.ANODE", "series": true,
      "wire": { "cat": "sig", "awg": "22", "colour": "white", "text": "the LED's drive, R1 at the Arduino end", "len": "about 15 cm", "cm": 15 } },
    { "ref": "R2", "kind": "R", "value": "10 kΩ", "job": "pull-down", "part": "the button's pull-down",
      "why": "so D2 reads low until the button is pressed", "where": "at the Arduino's D2 pin",
      "a": "nano.D2", "b": "gnd.BUS" },
    { "ref": "R3", "kind": "R", "value": "10 kΩ", "job": "divider", "part": "the light sensor's divider",
      "why": "so the light level reads as a voltage on A0", "where": "at the Arduino's A0 pin",
      "a": "nano.A0", "b": "gnd.BUS" },
    { "ref": "C1", "kind": "CE", "value": "100 µF 16 V", "job": "supply capacitor", "part": "the regulator's output capacitor",
      "why": "so the 5 V stays steady when the LED switches", "where": "across the regulator's own pins",
      "a": "reg.VOUT", "b": "reg.GND" }
  ],

  // every real wire: from one pin to another ("part.PIN"; a splice's pin is BUS)
  "wires": [
    { "from": "battery.PLUS", "to": "switch.IN", "cat": "raw", "awg": "22", "colour": "red", "ownLead": true, "text": "the battery holder's own red lead", "len": "10 cm", "cm": 10 },
    { "from": "switch.OUT", "to": "reg.VIN", "cat": "raw", "awg": "22", "colour": "yellow", "text": "battery + after the switch", "len": "5 cm", "cm": 5 },
    { "from": "battery.MINUS", "to": "gnd.BUS", "cat": "gnd", "awg": "22", "colour": "black", "text": "the battery holder's black lead" },
    { "from": "reg.GND", "to": "gnd.BUS", "cat": "gnd", "awg": "22", "colour": "black", "text": "the regulator's ground" },
    { "from": "reg.VOUT", "to": "v5.BUS", "cat": "logic", "awg": "22", "colour": "red", "text": "the regulator's 5 V" },
    { "from": "v5.BUS", "to": "nano.V5", "cat": "logic", "awg": "22", "colour": "red", "text": "the Arduino's 5 V" },
    { "from": "nano.GND", "to": "gnd.BUS", "cat": "gnd", "awg": "22", "colour": "black", "text": "the Arduino's ground" },
    { "from": "v5.BUS", "to": "button.A", "cat": "logic", "awg": "22", "colour": "red", "text": "5 V to the button" },
    { "from": "button.B", "to": "nano.D2", "cat": "sig", "awg": "22", "colour": "blue", "text": "the button to D2" },
    { "from": "v5.BUS", "to": "ldr.A", "cat": "logic", "awg": "22", "colour": "red", "text": "5 V to the light sensor" },
    { "from": "ldr.B", "to": "nano.A0", "cat": "sig", "awg": "22", "colour": "green", "text": "the light sensor to A0" },
    { "from": "led.CATHODE", "to": "gnd.BUS", "cat": "gnd", "awg": "22", "colour": "black", "text": "the LED's ground", "len": "about 25 cm", "cm": 25 }
  ]
});
