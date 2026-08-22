/* @ds-bundle: {"format":3,"namespace":"ProspectDesignSystem_c3fd64","components":[{"name":"Logo","sourcePath":"components/brand/Logo.jsx"},{"name":"Wordmark","sourcePath":"components/brand/Wordmark.jsx"},{"name":"STAGE_TONE","sourcePath":"components/core/Badge.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"ClaimCard","sourcePath":"components/data/ClaimCard.jsx"},{"name":"EmptyState","sourcePath":"components/data/EmptyState.jsx"},{"name":"KeyValue","sourcePath":"components/data/KeyValue.jsx"},{"name":"StageColumnHead","sourcePath":"components/data/StageColumnHead.jsx"},{"name":"StatChip","sourcePath":"components/data/StatChip.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"}],"sourceHashes":{"components/brand/Logo.jsx":"fc351bbcae94","components/brand/Wordmark.jsx":"b19d6956c081","components/core/Badge.jsx":"07d6262fa83c","components/core/Button.jsx":"2b0ad4626e40","components/core/IconButton.jsx":"edc728b04b25","components/core/Tag.jsx":"15721ee362b0","components/data/ClaimCard.jsx":"82f149d871bd","components/data/EmptyState.jsx":"a909a463c729","components/data/KeyValue.jsx":"1c45b0407d40","components/data/StageColumnHead.jsx":"6109eb99003e","components/data/StatChip.jsx":"7d6f4c7c3444","components/feedback/Dialog.jsx":"d4d75577c040","components/feedback/Toast.jsx":"db1676daba35","components/feedback/Tooltip.jsx":"5edb4e539651","components/forms/Checkbox.jsx":"7e6c4840e0c6","components/forms/Input.jsx":"1f03308bf22f","components/forms/Select.jsx":"cdd71ecc88d5","components/forms/Switch.jsx":"4fe3f23d980f","components/forms/Textarea.jsx":"14f3dcb64b29","ui_kits/prospect-app/AppShell.jsx":"c317c0981bb7","ui_kits/prospect-app/HuntReport.jsx":"a25ea3539110","ui_kits/prospect-app/ClaimDetail.jsx":"2c5e300306db","ui_kits/prospect-app/ClaimMap.jsx":"a9c4af749255","ui_kits/prospect-app/StakeDialog.jsx":"be805bd471e6","ui_kits/prospect-app/TailingsPond.jsx":"e104eb9dd625","ui_kits/prospect-app/data.js":"32e209436e73"},"inlinedExternals":[],"unexposedExports":[{"name":"labelStyle","sourcePath":"components/forms/Input.jsx"}]} */

(() => {

const __ds_ns = (window.ProspectDesignSystem_c3fd64 = window.ProspectDesignSystem_c3fd64 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Logo (the gold pan)
 * Self-contained inline SVG so it renders anywhere without an asset path.
 * variant="primary" is the 3/4 perspective pan (32px+); "compact" is the
 * concentric cut for 16–24px. The nugget is the only gold in the mark.
 */
function Logo({
  size = 40,
  variant = 'primary',
  title = 'Prospect',
  style,
  ...rest
}) {
  if (variant === 'compact') {
    return /*#__PURE__*/React.createElement("svg", _extends({
      width: size,
      height: size,
      viewBox: "0 0 120 120",
      role: "img",
      "aria-label": title,
      style: {
        display: 'block',
        ...style
      }
    }, rest), /*#__PURE__*/React.createElement("circle", {
      cx: "60",
      cy: "60",
      r: "50",
      fill: "#10171A"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "60",
      cy: "60",
      r: "50",
      fill: "none",
      stroke: "#E7E1D3",
      strokeWidth: "7"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "60",
      cy: "60",
      r: "33",
      fill: "none",
      stroke: "#6E767B",
      strokeWidth: "2.5",
      opacity: "0.55"
    }), /*#__PURE__*/React.createElement("polygon", {
      points: "44,68 50,50 60,43 71,47 78,60 71,73 54,76",
      fill: "#CDA349",
      stroke: "#8F6E26",
      strokeWidth: "2",
      strokeLinejoin: "round"
    }), /*#__PURE__*/React.createElement("polygon", {
      points: "50,50 60,43 65,57 52,60",
      fill: "#E2C06B"
    }), /*#__PURE__*/React.createElement("polygon", {
      points: "71,47 78,60 71,73 62,58",
      fill: "#A57E2C"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "56",
      cy: "54",
      r: "2.4",
      fill: "#F6E8B0"
    }));
  }
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 120 120",
    role: "img",
    "aria-label": title,
    style: {
      display: 'block',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("path", {
    d: "M14,52 Q60,118 106,52",
    fill: "#10171A"
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "60",
    cy: "52",
    rx: "46",
    ry: "18",
    fill: "#10171A"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M32,49 Q60,40 88,49",
    fill: "none",
    stroke: "#6E767B",
    strokeWidth: "1.8",
    opacity: "0.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M37,45.5 Q60,38 83,45.5",
    fill: "none",
    stroke: "#6E767B",
    strokeWidth: "1.8",
    opacity: "0.4"
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "60",
    cy: "52",
    rx: "46",
    ry: "18",
    fill: "none",
    stroke: "#E7E1D3",
    strokeWidth: "6",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14,52 Q60,118 106,52",
    fill: "none",
    stroke: "#E7E1D3",
    strokeWidth: "6",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("ellipse", {
    cx: "60",
    cy: "81",
    rx: "16",
    ry: "3",
    fill: "#000",
    opacity: "0.42"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "43",
    cy: "74",
    r: "1.7",
    fill: "#CDA349"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "79",
    cy: "75",
    r: "1.6",
    fill: "#CDA349"
  }), /*#__PURE__*/React.createElement("polygon", {
    points: "45,77 50,63 60,57.5 70,60 77,70 71,81 56,83",
    fill: "#CDA349",
    stroke: "#8F6E26",
    strokeWidth: "1.7",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("polygon", {
    points: "50,63 60,57.5 64,68 53,70.5",
    fill: "#E2C06B"
  }), /*#__PURE__*/React.createElement("polygon", {
    points: "70,60 77,70 71,81 63,69",
    fill: "#A57E2C"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "55",
    cy: "64",
    r: "2",
    fill: "#F6E8B0"
  }));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Logo.jsx", error: String((e && e.message) || e) }); }

// components/brand/Wordmark.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Wordmark (lockup)
 * Pickaxe + "Prospect." lockup (Logo v2). Renders the approved lockup asset.
 */
function Wordmark({
  size = 24,
  showMark = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("img", _extends({
    src: __ds_scope.lockupUrl,
    alt: "Prospect",
    style: {
      height: size * 1.75,
      width: 'auto',
      display: 'block',
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Wordmark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Wordmark.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Badge (status chip)
 * The pipeline stage indicator. Mining name on the chip; the plain meaning
 * lives nearby (column gloss / tooltip), never decoded here.
 */
const TONES = {
  neutral: {
    color: 'var(--text-muted)',
    border: 'var(--galena-dim)',
    bg: 'transparent'
  },
  gold: {
    color: 'var(--accent)',
    border: 'var(--gold-sh)',
    bg: 'var(--accent-wash-soft)'
  },
  positive: {
    color: 'var(--positive)',
    border: 'var(--positive)',
    bg: 'transparent'
  },
  danger: {
    color: 'var(--danger)',
    border: 'var(--danger)',
    bg: 'transparent'
  }
};

/** Map a pipeline stage to its tone. Strike = gold (the scarce accent). */
const STAGE_TONE = {
  Showings: 'neutral',
  Staked: 'neutral',
  'Working the Vein': 'positive',
  Strike: 'gold',
  Tailings: 'danger'
};
function Badge({
  tone = 'neutral',
  // 'neutral' | 'gold' | 'positive' | 'danger'
  solid = false,
  style,
  children,
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      fontWeight: 500,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      padding: '4px 9px',
      borderRadius: 'var(--r-pill)',
      border: '1px solid',
      borderColor: solid ? 'transparent' : t.border,
      background: solid ? t.color : t.bg,
      color: solid ? 'var(--text-on-gold)' : t.color,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { STAGE_TONE, Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Button
 * Gold is the scarce accent: use variant="gold" for the ONE primary action
 * in a view; everything else is ghost or quiet.
 */
function Button({
  variant = 'ghost',
  // 'gold' | 'ghost' | 'quiet' | 'danger'
  size = 'md',
  // 'sm' | 'md' | 'lg'
  iconLeft = null,
  iconRight = null,
  disabled = false,
  type = 'button',
  onClick,
  style,
  children,
  ...rest
}) {
  const pads = {
    sm: '8px 12px',
    md: '11px 18px',
    lg: '14px 22px'
  };
  const fonts = {
    sm: 13,
    md: 14.5,
    lg: 16
  };
  const variants = {
    gold: {
      background: 'var(--accent)',
      color: 'var(--text-on-gold)',
      borderColor: 'var(--accent-press)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-body)',
      borderColor: 'var(--galena-dim)'
    },
    quiet: {
      background: 'transparent',
      color: 'var(--text-muted)',
      borderColor: 'transparent'
    },
    danger: {
      background: 'transparent',
      color: 'var(--danger)',
      borderColor: 'var(--danger)'
    }
  };
  const v = variants[variant] || variants.ghost;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    onClick: onClick,
    disabled: disabled,
    "data-variant": variant,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      fontSize: fonts[size],
      lineHeight: 1,
      padding: pads[size],
      borderRadius: 'var(--r-md)',
      border: '1px solid',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background var(--dur-flick) var(--ease-sluice), border-color var(--dur-flick) var(--ease-sluice), transform var(--dur-flick) var(--ease-sluice)',
      whiteSpace: 'nowrap',
      ...v,
      ...style
    },
    onMouseEnter: e => {
      if (disabled) return;
      if (variant === 'gold') e.currentTarget.style.background = 'var(--accent-hover)';else if (variant === 'ghost') e.currentTarget.style.borderColor = 'var(--galena)';else if (variant === 'quiet') e.currentTarget.style.color = 'var(--text-body)';else if (variant === 'danger') e.currentTarget.style.background = 'var(--danger-wash)';
    },
    onMouseLeave: e => {
      if (disabled) return;
      e.currentTarget.style.background = v.background;
      e.currentTarget.style.borderColor = v.borderColor;
      e.currentTarget.style.color = v.color;
      e.currentTarget.style.transform = 'none';
    },
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'translateY(1px)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'none';
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — IconButton
 * Square, quiet affordance for toolbar / card actions. Houses a Lucide SVG.
 */
function IconButton({
  size = 'md',
  // 'sm' | 'md'
  variant = 'ghost',
  // 'ghost' | 'gold'
  label,
  // accessible label (required)
  disabled = false,
  onClick,
  style,
  children,
  ...rest
}) {
  const dim = size === 'sm' ? 30 : 36;
  const isGold = variant === 'gold';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    onClick: onClick,
    disabled: disabled,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim,
      height: dim,
      borderRadius: 'var(--r-md)',
      border: '1px solid',
      borderColor: isGold ? 'var(--accent-press)' : 'var(--galena-dim)',
      background: isGold ? 'var(--accent)' : 'transparent',
      color: isGold ? 'var(--text-on-gold)' : 'var(--text-muted)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background var(--dur-flick) var(--ease-sluice), border-color var(--dur-flick) var(--ease-sluice), color var(--dur-flick) var(--ease-sluice), transform var(--dur-flick) var(--ease-sluice)',
      ...style
    },
    onMouseEnter: e => {
      if (disabled) return;
      if (isGold) e.currentTarget.style.background = 'var(--accent-hover)';else {
        e.currentTarget.style.borderColor = 'var(--galena)';
        e.currentTarget.style.color = 'var(--text-body)';
      }
    },
    onMouseLeave: e => {
      if (disabled) return;
      e.currentTarget.style.background = isGold ? 'var(--accent)' : 'transparent';
      e.currentTarget.style.borderColor = isGold ? 'var(--accent-press)' : 'var(--galena-dim)';
      e.currentTarget.style.color = isGold ? 'var(--text-on-gold)' : 'var(--text-muted)';
      e.currentTarget.style.transform = 'none';
    },
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'translateY(1px)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'none';
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Tag
 * Quiet metadata pill for claim attributes (comp, location, source).
 * Mono, low-key; never gold.
 */
function Tag({
  icon = null,
  style,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-muted)',
      background: 'var(--bg-sunken)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-sm)',
      padding: '3px 8px',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/ClaimCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — ClaimCard
 * The job card on the Claim Map board. When `strike` is set, it becomes the
 * single gold-accented element (border + gold wash). Otherwise it's quiet rock.
 */
function ClaimCard({
  role,
  company,
  meta,
  // string or node — comp, schedule, "staked 3d ago"
  tags = [],
  // array of strings → Tag pills
  strike = false,
  onClick,
  style,
  className,
  children,
  ...rest
}) {
  // Hover border+shadow deepen is a pre-painted `::after` (see motion.css
  // `.claim-card::after`) cross-faded via opacity — compositor-only per the
  // §4/§8 amendment's ClaimCard carve-out (M8): this is the most-repeated
  // hover surface on the board, so it stays exempt from the discrete-
  // affordance paint exception the rest of the design system gets. `lift`
  // (transform) stays imperative here since transform is already
  // compositor-safe and needs the onClick gating.
  const classes = ['claim-card', onClick && 'claim-card--interactive', strike && 'claim-card--strike', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", _extends({
    onClick: onClick,
    className: classes,
    style: {
      position: 'relative',
      background: strike ? 'linear-gradient(180deg, var(--accent-wash), var(--accent-wash-soft))' : 'var(--surface-card)',
      border: '1px solid',
      borderColor: strike ? 'var(--gold-sh)' : 'var(--line)',
      borderRadius: 'var(--r-md)',
      padding: '10px 11px',
      cursor: onClick ? 'pointer' : 'default',
      boxShadow: 'var(--shadow-card)',
      transform: 'translateY(0)',
      transition: 'transform var(--dur-flick) var(--ease-sluice)',
      contain: 'content',
      ...style
    },
    onMouseEnter: e => {
      if (!onClick) return;
      e.currentTarget.style.transform = 'translateY(calc(-1 * var(--lift)))';
    },
    onMouseLeave: e => {
      if (!onClick) return;
      e.currentTarget.style.transform = 'translateY(0)';
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1.25,
      color: 'var(--text-strong)'
    }
  }, role), company && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, company), meta && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      marginTop: 7,
      color: strike ? 'var(--accent)' : 'var(--text-muted)'
    }
  }, meta), tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5,
      marginTop: 8
    }
  }, tags.map((t, i) => /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    key: i
  }, t))), children);
}
Object.assign(__ds_scope, { ClaimCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ClaimCard.jsx", error: String((e && e.message) || e) }); }

// components/data/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — EmptyState
 * Empty screens are invitations to act, in the interface's voice.
 * Slab title, sans line, optional action.
 */
function EmptyState({
  title,
  line,
  action,
  icon = null,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 12,
      padding: '48px 24px',
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--text-muted)',
      marginBottom: 4
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-slab)',
      fontWeight: 600,
      fontSize: 20,
      color: 'var(--text-strong)'
    }
  }, title), line && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--text-muted)',
      maxWidth: '34ch'
    }
  }, line), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/data/KeyValue.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — KeyValue
 * The claim-ticket detail grid: mono uppercase key, quartz value.
 * Pass `num` on a row to render its value in mono (comp, dates).
 */
function KeyValue({
  rows = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: '8px 16px',
      fontSize: 13.5,
      ...style
    }
  }, rest), rows.map((r, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      paddingTop: 2
    }
  }, r.k), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-body)',
      fontFamily: r.num ? 'var(--font-mono)' : 'var(--font-sans)'
    }
  }, r.v))));
}
Object.assign(__ds_scope, { KeyValue });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/KeyValue.jsx", error: String((e && e.message) || e) }); }

// components/data/StageColumnHead.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — StageColumnHead
 * Board column header: mono stage name + count. The Strike column heads gold.
 */
function StageColumnHead({
  name,
  count,
  gloss,
  strike = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      marginBottom: 8,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      color: strike ? 'var(--accent)' : 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: strike ? 'var(--accent)' : 'var(--text-body)'
    }
  }, count)), gloss && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 10.5,
      color: 'var(--text-muted)',
      marginTop: 3,
      textTransform: 'none',
      letterSpacing: 0
    }
  }, gloss));
}
Object.assign(__ds_scope, { StageColumnHead });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StageColumnHead.jsx", error: String((e && e.message) || e) }); }

// components/data/StatChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — StatChip (metric reading)
 * A single metric in the Hunt Report grid: mono key, big mono value, sub.
 * `hi` accents the value gold — for the ONE most valuable metric (strikes).
 */
function StatChip({
  k,
  value,
  sub,
  hi = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--bg-sunken)',
      padding: '16px 18px 14px',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, k), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 30,
      fontWeight: 500,
      lineHeight: 1,
      marginTop: 6,
      color: hi ? 'var(--accent)' : 'var(--text-body)'
    }
  }, value), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--text-muted)',
      marginTop: 5
    }
  }, sub));
}
Object.assign(__ds_scope, { StatChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatChip.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Dialog
 * Native <dialog>: the element itself is the raised slate panel; the
 * browser's ::backdrop (styled in motion.css) is the scrim. Kept mounted
 * across open/close so motion.css's @starting-style/allow-discrete
 * transition can animate both entrance and exit (§3.5).
 */
function Dialog({
  open,
  title,
  children,
  footer = null,
  onClose,
  width = 460,
  style,
  ...rest
}) {
  const dialogRef = React.useRef(null);
  const titleId = React.useId();
  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();else if (!open && el.open) el.close();
  }, [open]);
  function handleCancel(e) {
    // Esc: don't let the browser snap it shut — close via `open` going
    // false so the same animated exit plays as backdrop-click/Cancel.
    e.preventDefault();
    onClose && onClose();
  }
  function handleClick(e) {
    // Native backdrop-click: the click target is the <dialog> itself only
    // when it lands outside the rendered content box.
    if (e.target === dialogRef.current) onClose && onClose();
  }
  return /*#__PURE__*/React.createElement("dialog", _extends({
    ref: dialogRef,
    className: "ds-dialog",
    "aria-labelledby": title ? titleId : undefined,
    onCancel: handleCancel,
    onClick: handleClick,
    style: {
      width,
      maxWidth: '100%',
      ...style
    }
  }, rest), title && /*#__PURE__*/React.createElement("div", {
    id: titleId,
    className: "ds-dialog-title"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "ds-dialog-body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "ds-dialog-footer"
  }, footer));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Toast
 * Confirmation in the interface's voice ("Claim staked," never "Submitted").
 * Slides up from bottom; tone tints the left rule.
 */
function Toast({
  message,
  tone = 'neutral',
  action = null,
  style,
  ...rest
}) {
  const accent = {
    neutral: 'var(--galena)',
    gold: 'var(--accent)',
    positive: 'var(--positive)',
    danger: 'var(--danger)'
  }[tone] || 'var(--galena)';
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 14,
      background: 'var(--surface-raised)',
      border: '1px solid var(--line)',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-pop)',
      padding: '12px 16px',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-body)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", null, message), action);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Tooltip
 * Carries the plain meaning behind a mining term (the legibility rule).
 * Hover/focus to reveal a small dark popover.
 */
function Tooltip({
  label,
  side = 'top',
  children,
  style,
  ...rest
}) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 8
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: 8
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: 8
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: 8
    }
  }[side];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false)
  }, rest), children, open && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    className: "ds-tooltip-fade",
    style: {
      position: 'absolute',
      ...pos,
      zIndex: 40,
      whiteSpace: 'nowrap',
      background: 'var(--slate-900)',
      color: 'var(--text-body)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-sm)',
      boxShadow: 'var(--shadow-pop)',
      padding: '6px 10px',
      fontFamily: 'var(--font-sans)',
      fontSize: 12.5,
      pointerEvents: 'none'
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Checkbox
 * Square check; gold fill when set (counts as accent — use sparingly in lists).
 */
function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-body)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    role: "checkbox",
    "aria-checked": checked,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 18,
      height: 18,
      flex: 'none',
      borderRadius: 5,
      border: '1px solid',
      borderColor: checked ? 'var(--accent-press)' : 'var(--galena)',
      background: checked ? 'var(--accent)' : 'var(--bg-sunken)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background var(--dur-flick) var(--ease-sluice), border-color var(--dur-flick) var(--ease-sluice)'
    }
  }, checked && /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2 5 8.7 9.5 3.5",
    stroke: "#1C1A12",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    onChange: e => onChange && onChange(e.target.checked),
    disabled: disabled,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Input
 * Field sits in a sunken well; gold focus ring. Mono label above.
 */
function Input({
  label,
  hint,
  mono = false,
  invalid = false,
  id,
  style,
  ...rest
}) {
  const fid = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: fid,
    style: labelStyle
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    id: fid,
    "aria-invalid": invalid || undefined,
    style: {
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-body)',
      background: 'var(--bg-sunken)',
      border: '1px solid',
      borderColor: invalid ? 'var(--danger)' : 'var(--line)',
      borderRadius: 'var(--r-md)',
      padding: '10px 12px',
      outline: 'none',
      transition: 'border-color var(--dur-flick) var(--ease-sluice), box-shadow var(--dur-flick) var(--ease-sluice)',
      ...style
    },
    onFocus: e => {
      e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--accent)';
      e.currentTarget.style.boxShadow = '0 0 0 2px rgba(205,163,73,.22)';
    },
    onBlur: e => {
      e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--line)';
      e.currentTarget.style.boxShadow = 'none';
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: invalid ? 'var(--danger)' : 'var(--text-muted)'
    }
  }, hint));
}
const labelStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)'
};
Object.assign(__ds_scope, { Input, labelStyle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Select
 * Native select restyled into a sunken well with a mono caret.
 */
function Select({
  label,
  hint,
  options = [],
  id,
  style,
  children,
  ...rest
}) {
  const fid = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: fid,
    style: __ds_scope.labelStyle
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: fid,
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-body)',
      background: 'var(--bg-sunken)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      padding: '10px 34px 10px 12px',
      outline: 'none',
      cursor: 'pointer',
      transition: 'border-color var(--dur-flick) var(--ease-sluice)',
      ...style
    },
    onFocus: e => {
      e.currentTarget.style.borderColor = 'var(--accent)';
    },
    onBlur: e => {
      e.currentTarget.style.borderColor = 'var(--line)';
    }
  }, rest), children || options.map(o => {
    const val = typeof o === 'string' ? o : o.value;
    const lab = typeof o === 'string' ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, lab);
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)',
      fontSize: 12
    }
  }, "\u25BE")), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Switch
 * Toggle; gold track when on. The knob is quartz.
 */
function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-body)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    role: "switch",
    "aria-checked": checked,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      position: 'relative',
      width: 38,
      height: 22,
      flex: 'none',
      borderRadius: 999,
      background: checked ? 'var(--accent)' : 'var(--galena-dim)',
      border: '1px solid',
      borderColor: checked ? 'var(--accent-press)' : 'var(--galena)',
      transition: 'background var(--dur-state) var(--ease-sluice), border-color var(--dur-state) var(--ease-sluice)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: 999,
      background: checked ? 'var(--text-on-gold)' : 'var(--quartz)',
      transition: 'left var(--dur-state) var(--ease-sluice)'
    }
  })), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    onChange: e => onChange && onChange(e.target.checked),
    disabled: disabled,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prospect — Textarea
 * For core samples / logbook notes. Sunken well, gold focus, sans body.
 */
function Textarea({
  label,
  hint,
  rows = 4,
  id,
  style,
  ...rest
}) {
  const fid = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: fid,
    style: __ds_scope.labelStyle
  }, label), /*#__PURE__*/React.createElement("textarea", _extends({
    id: fid,
    rows: rows,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      lineHeight: 1.55,
      color: 'var(--text-body)',
      background: 'var(--bg-sunken)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      padding: '10px 12px',
      outline: 'none',
      resize: 'vertical',
      transition: 'border-color var(--dur-flick) var(--ease-sluice), box-shadow var(--dur-flick) var(--ease-sluice)',
      ...style
    },
    onFocus: e => {
      e.currentTarget.style.borderColor = 'var(--accent)';
      e.currentTarget.style.boxShadow = '0 0 0 2px rgba(205,163,73,.22)';
    },
    onBlur: e => {
      e.currentTarget.style.borderColor = 'var(--line)';
      e.currentTarget.style.boxShadow = 'none';
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/AppShell.jsx
try { (() => {
// Prospect UI kit — app shell (top bar + left rail)
const {
  Logo,
  Wordmark,
  Button,
  IconButton,
  Badge
} = window.ProspectDesignSystem_c3fd64;
function NavIcon({
  d
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.75",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, d);
}
const icons = {
  map: /*#__PURE__*/React.createElement(NavIcon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M9 4v14M15 6v14"
    }))
  }),
  report: /*#__PURE__*/React.createElement(NavIcon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 3v18h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 14l3-4 3 3 4-6"
    }))
  }),
  tailings: /*#__PURE__*/React.createElement(NavIcon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"
    }))
  }),
  survey: /*#__PURE__*/React.createElement(NavIcon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "m21 21-4.3-4.3"
    }))
  })
};
function AppShell({
  view,
  setView,
  onStake,
  children
}) {
  const nav = [{
    id: 'map',
    label: 'Claim Map',
    plain: 'Board'
  }, {
    id: 'report',
    label: 'Hunt Report',
    plain: 'Analytics'
  }, {
    id: 'tailings',
    label: 'Tailings Pond',
    plain: 'Archive'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '224px 1fr',
      minHeight: '100vh',
      background: 'var(--bg-base)'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      borderRight: '1px solid var(--line)',
      background: 'var(--slate-850)',
      padding: '20px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 22
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 21
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "gold",
    size: "sm",
    onClick: onStake,
    style: {
      width: '100%'
    },
    iconLeft: /*#__PURE__*/React.createElement("svg", {
      width: "15",
      height: "15",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2",
      strokeLinecap: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14M5 12h14"
    }))
  }, "Stake a claim"), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, nav.map(n => {
    const active = view === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => setView(n.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        textAlign: 'left',
        padding: '9px 11px',
        borderRadius: 'var(--r-md)',
        border: '1px solid',
        borderColor: active ? 'var(--line)' : 'transparent',
        background: active ? 'var(--surface-card)' : 'transparent',
        color: active ? 'var(--text-strong)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        transition: 'color var(--dur-flick), background var(--dur-flick)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: active ? 'var(--accent)' : 'var(--text-muted)'
      }
    }, icons[n.id]), /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        lineHeight: 1.15
      }
    }, n.label, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 9.5,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--text-faint)'
      }
    }, n.plain)));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      paddingTop: 16,
      borderTop: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 999,
      background: 'var(--surface-raised)',
      border: '1px solid var(--line)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-soft)'
    }
  }, "JM"), /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-body)'
    }
  }, "Jordan M."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, "self-hosted")))), /*#__PURE__*/React.createElement("main", {
    className: "prospect-field",
    style: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, children));
}
function ViewHeader({
  eyebrow,
  title,
  sub,
  right
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 24,
      padding: '24px 30px 18px',
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.22em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: 'var(--font-slab)',
      fontWeight: 700,
      fontSize: 28,
      color: 'var(--text-strong)',
      marginTop: 8,
      letterSpacing: '-.01em'
    }
  }, title), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: 'var(--text-muted)',
      marginTop: 5
    }
  }, sub)), right);
}
window.AppShell = AppShell;
window.ViewHeader = ViewHeader;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/HuntReport.jsx
try { (() => {
// Prospect UI kit — Hunt Report (analytics)
const {
  StatChip,
  Badge
} = window.ProspectDesignSystem_c3fd64;
function StrataFunnel({
  stages,
  claims
}) {
  // counts per stage, widest at top
  const counts = stages.map(s => ({
    name: s.short || s.key,
    key: s.key,
    n: claims.filter(c => c.stage === s.key).length
  }));
  // illustrative widths
  const widths = [100, 76, 54, 34, 18];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, counts.map((c, i) => {
    const strike = c.key === 'Strike';
    return /*#__PURE__*/React.createElement("div", {
      key: c.key,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 130,
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: strike ? 'var(--accent)' : 'var(--text-muted)'
      }
    }, c.name), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 30,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: widths[i] + '%',
        height: '100%',
        borderRadius: 3,
        background: strike ? 'linear-gradient(180deg, var(--gold-hi), var(--gold-sh))' : 'var(--surface-raised)',
        border: '1px solid',
        borderColor: strike ? 'var(--gold-edge)' : 'var(--line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: strike ? 'var(--text-on-gold)' : 'var(--text-soft)',
        fontWeight: strike ? 700 : 400
      }
    }, c.n)));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 130
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, "wide rock up top \xB7 the gold seam at the bottom")));
}
function HuntReport({
  metrics,
  stages,
  claims
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 30px 48px',
      display: 'grid',
      gridTemplateColumns: '1.05fr 1fr',
      gap: 26,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--bg-sunken)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      padding: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-slab)',
      fontWeight: 600,
      fontSize: 16,
      color: 'var(--text-strong)'
    }
  }, "Your search, read like a core sample"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '.12em',
      textTransform: 'uppercase',
      color: 'var(--accent)',
      border: '1px solid var(--gold-sh)',
      padding: '4px 9px',
      borderRadius: 'var(--r-sm)'
    }
  }, "cross-section")), /*#__PURE__*/React.createElement(StrataFunnel, {
    stages: stages,
    claims: claims
  })), /*#__PURE__*/React.createElement("section", {
    style: {
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '14px 18px',
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-slab)',
      fontWeight: 600,
      fontSize: 15,
      color: 'var(--text-strong)'
    }
  }, "Hunt Report"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '.12em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, "30-day yield")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 1,
      background: 'var(--line)'
    }
  }, metrics.map(m => /*#__PURE__*/React.createElement(StatChip, {
    key: m.k,
    k: m.k,
    value: m.v,
    sub: m.sub,
    hi: m.hi
  })))));
}
window.HuntReport = HuntReport;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/HuntReport.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/ClaimDetail.jsx
try { (() => {
// Prospect UI kit — Claim detail (ticket + logbook drawer)
const {
  Badge,
  Tag,
  KeyValue,
  Textarea,
  Button,
  IconButton,
  Tooltip,
  STAGE_TONE
} = window.ProspectDesignSystem_c3fd64;
const STAGE_GLOSS = {
  Showings: 'Saved / interested',
  Staked: 'Applied',
  'Working the Vein': 'Active interview loops',
  Strike: 'Offer',
  Tailings: 'Rejected / dead'
};
function ClaimDetail({
  claim,
  onClose,
  onTailings
}) {
  if (!claim) return null;
  const tone = STAGE_TONE[claim.stage] || 'neutral';
  const rows = [claim.comp && {
    k: 'Comp',
    v: claim.comp,
    num: true
  }, claim.remote && {
    k: 'Location',
    v: claim.remote
  }, claim.source && {
    k: 'Source',
    v: claim.source
  }, claim.next && {
    k: 'Next',
    v: claim.next
  }, claim.contacts && {
    k: 'Contacts',
    v: claim.contacts
  }].filter(Boolean);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      background: 'rgba(16,23,26,.6)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: 460,
      maxWidth: '100%',
      height: '100%',
      background: 'var(--surface-card)',
      borderLeft: '1px solid var(--line)',
      boxShadow: 'var(--shadow-pop)',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '14px 18px',
      borderBottom: '1px dashed var(--galena-dim)',
      background: 'var(--bg-sunken)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, claim.id, " \xB7 staked 2026-06-09"), /*#__PURE__*/React.createElement(IconButton, {
    size: "sm",
    label: "Close",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 6l12 12M18 6 6 18"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Tooltip, {
    label: STAGE_GLOSS[claim.stage]
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: tone
  }, claim.stage)), claim.strike && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--accent)'
    }
  }, "paydirt")), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: 'var(--font-slab)',
      fontWeight: 700,
      fontSize: 23,
      color: 'var(--text-strong)',
      marginTop: 8
    }
  }, claim.role), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--text-muted)',
      margin: '3px 0 18px',
      fontSize: 14
    }
  }, claim.company, claim.remote ? ` — ${claim.remote}` : ''), /*#__PURE__*/React.createElement(KeyValue, {
    rows: rows
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      paddingTop: 14,
      borderTop: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '.12em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      marginBottom: 8
    }
  }, "Core samples \xB7 logbook"), /*#__PURE__*/React.createElement(Textarea, {
    rows: 4,
    defaultValue: claim.samples || '',
    placeholder: "Log what you dug up \u2014 contacts, comp signals, gut read\u2026"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      justifyContent: 'space-between',
      padding: '14px 20px',
      borderTop: '1px solid var(--line)',
      background: 'var(--bg-sunken)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm",
    onClick: () => onTailings(claim)
  }, "Move to tailings"), /*#__PURE__*/React.createElement(Button, {
    variant: "gold",
    size: "sm"
  }, "Advance stage \u2192"))));
}
window.ClaimDetail = ClaimDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/ClaimDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/ClaimMap.jsx
try { (() => {
// Prospect UI kit — Claim Map (the board)
const {
  ClaimCard,
  StageColumnHead,
  Badge
} = window.ProspectDesignSystem_c3fd64;
function ClaimMap({
  claims,
  stages,
  onOpen
}) {
  const counts = {};
  stages.forEach(s => {
    counts[s.key] = claims.filter(c => c.stage === s.key).length;
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 30px 40px',
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(210px, 1fr))',
      gap: 14,
      minWidth: 1080
    }
  }, stages.map(s => {
    const strike = s.key === 'Strike';
    const items = claims.filter(c => c.stage === s.key);
    return /*#__PURE__*/React.createElement("div", {
      key: s.key,
      style: {
        background: 'var(--bg-sunken)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        padding: 12,
        alignSelf: 'start',
        boxShadow: strike ? 'none' : 'var(--shadow-panel)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '2px 2px 12px'
      }
    }, /*#__PURE__*/React.createElement(StageColumnHead, {
      name: s.key,
      count: counts[s.key],
      gloss: s.gloss,
      strike: strike
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }
    }, items.map(c => /*#__PURE__*/React.createElement(ClaimCard, {
      key: c.id,
      role: c.role,
      company: c.company,
      meta: c.meta,
      tags: c.tags,
      strike: c.strike,
      onClick: () => onOpen(c)
    })), items.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        height: 36,
        border: '1px dashed var(--galena-dim)',
        borderRadius: 'var(--r-md)',
        opacity: .5
      }
    })));
  })));
}
window.ClaimMap = ClaimMap;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/ClaimMap.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/StakeDialog.jsx
try { (() => {
// Prospect UI kit — Stake a claim dialog
const {
  Dialog,
  Input,
  Select,
  Button
} = window.ProspectDesignSystem_c3fd64;
function StakeDialog({
  open,
  onClose,
  onStake
}) {
  const [role, setRole] = React.useState('');
  const [company, setCompany] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setRole('');
      setCompany('');
    }
  }, [open]);
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    title: "Stake a claim",
    onClose: onClose,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "quiet",
      onClick: onClose
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "gold",
      disabled: !role.trim(),
      onClick: () => onStake(role || 'Untitled role', company || 'Unknown')
    }, "Stake a claim"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Role",
    placeholder: "Senior Backend Engineer",
    value: role,
    onChange: e => setRole(e.target.value),
    autoFocus: true
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Company",
    placeholder: "Granite Map Co.",
    value: company,
    onChange: e => setCompany(e.target.value)
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Stage",
    options: ['Showings', 'Staked'],
    defaultValue: "Staked"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11.5,
      color: 'var(--text-faint)',
      margin: 0
    }
  }, "survey the field \xB7 stake the few worth your time")));
}
window.StakeDialog = StakeDialog;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/StakeDialog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/TailingsPond.jsx
try { (() => {
// Prospect UI kit — Tailings Pond (archive of dead claims)
const {
  EmptyState,
  Button,
  Badge
} = window.ProspectDesignSystem_c3fd64;
function TailingsPond({
  items,
  onStake
}) {
  if (!items || items.length === 0) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '60px 30px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 480,
        margin: '0 auto',
        border: '1px dashed var(--galena-dim)',
        borderRadius: 'var(--r-lg)'
      }
    }, /*#__PURE__*/React.createElement(EmptyState, {
      title: "Nothing in the tailings pond yet.",
      line: "Dead, withdrawn, and passed claims settle here. Move one from a claim's drawer to see it.",
      action: /*#__PURE__*/React.createElement(Button, {
        variant: "ghost",
        onClick: onStake
      }, "Stake a claim")
    })));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '22px 30px 40px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 760
    }
  }, items.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '12px 14px',
      background: 'var(--surface-card)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      opacity: .85
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-soft)'
    }
  }, c.role), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, c.company, " \xB7 ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)'
    }
  }, c.id))), /*#__PURE__*/React.createElement(Badge, {
    tone: "danger"
  }, c.reason || 'Tailings'))));
}
window.TailingsPond = TailingsPond;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/TailingsPond.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prospect-app/data.js
try { (() => {
// Prospect — sample claim data for the UI kit (fake, illustrative)
window.PROSPECT_DATA = {
  stages: [{
    key: 'Showings',
    gloss: 'Saved'
  }, {
    key: 'Staked',
    gloss: 'Applied'
  }, {
    key: 'Working the Vein',
    gloss: 'Interviewing',
    short: 'Vein'
  }, {
    key: 'Strike',
    gloss: 'Offer'
  }],
  claims: [{
    id: 'CLM-0042',
    role: 'Senior Backend Eng',
    company: 'Northvale Robotics',
    stage: 'Showings',
    meta: '$180–210k · remote',
    tags: ['remote', '$180–210k']
  }, {
    id: 'CLM-0043',
    role: 'Platform Engineer',
    company: 'Atlas Data',
    stage: 'Showings',
    meta: '$165–195k · hybrid',
    tags: ['hybrid']
  }, {
    id: 'CLM-0044',
    role: 'Backend Engineer',
    company: 'Quarry Logistics',
    stage: 'Showings',
    meta: '$160–180k · onsite'
  }, {
    id: 'CLM-0045',
    role: 'Infra Engineer',
    company: 'Cobalt Systems',
    stage: 'Staked',
    meta: 'staked 3d ago',
    tags: ['$170k']
  }, {
    id: 'CLM-0046',
    role: 'SRE',
    company: 'Meridian Health',
    stage: 'Staked',
    meta: 'staked 1w ago'
  }, {
    id: 'CLM-0048',
    role: 'Full-Stack Eng',
    company: 'Tidewater Labs',
    stage: 'Working the Vein',
    meta: 'screen · Thu 2pm'
  }, {
    id: 'CLM-0047',
    role: 'Senior Backend Engineer',
    company: 'Granite Map Co.',
    stage: 'Working the Vein',
    meta: 'onsite · Jun 26',
    comp: '$185k – $215k + 0.05%',
    source: 'Referral · Dana R.',
    next: 'Onsite loop — Jun 26, 11:00',
    contacts: 'Dana R. (recruiter) · Sam K. (hiring mgr)',
    remote: 'Remote (US)',
    samples: 'Hiring manager is ex-Stripe infra. Take-home was a queue design — went well. Team owns the routing layer; growing fast. Ask about on-call rotation.'
  }, {
    id: 'CLM-0049',
    role: 'Senior Engineer',
    company: 'Lumen Foundry',
    stage: 'Strike',
    meta: 'offer · $205k',
    strike: true,
    comp: '$205k + 0.08%',
    source: 'Cold apply',
    next: 'Decision by Jul 1'
  }],
  metrics: [{
    k: 'Claims staked',
    v: '18',
    sub: '+5 this week'
  }, {
    k: 'Response rate',
    v: '50%',
    sub: 'replied after applying'
  }, {
    k: 'Strikes',
    v: '1',
    sub: 'offer in hand',
    hi: true
  }, {
    k: 'Active veins',
    v: '4',
    sub: 'live loops'
  }, {
    k: 'Median response',
    v: '6d',
    sub: 'staked → reply'
  }, {
    k: 'Tailings',
    v: '13',
    sub: 'closed / passed'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prospect-app/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.STAGE_TONE = __ds_scope.STAGE_TONE;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.ClaimCard = __ds_scope.ClaimCard;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.KeyValue = __ds_scope.KeyValue;

__ds_ns.StageColumnHead = __ds_scope.StageColumnHead;

__ds_ns.StatChip = __ds_scope.StatChip;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

})();
