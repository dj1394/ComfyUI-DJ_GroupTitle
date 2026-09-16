import { app } from "/scripts/app.js";

const PATCH_FLAG = "djGroupTitleInstalled";
const CANVAS_PATCH_FLAG = "__djGroupTitleHitAreaPatched";
const SNAP_GUIDE_PATCH_FLAG = "__djGroupTitleSnapGuidePatched";
const CONTEXT_MENU_PATCH_FLAG = "__djInlineGroupMenuPatched";
const DRAG_END_PATCH_FLAG = "__djGroupTitleDragEndPatched";
const MOVE_PATCH_FLAG = "__djGroupTitleMovePatched";
const EDITOR_PATCH_FLAG = "djGroupTitleEditorInstalled";
const DEFAULT_GROUP_FONT_SIZE = 20;
const MIN_GROUP_FONT_SIZE = 12;
const MAX_GROUP_FONT_SIZE = 300;
const GROUP_TITLE_NODE_GAP = 24;
const FONT_SLIDER_PATCH_FLAG = "djGroupTitleFontSliderInstalled";
const FONT_SLIDER_PIXELS_PER_STEP = 2;
const FONT_SLIDER_VISUAL_MAX = 96;
const GROUP_FONT_BAR_ATTR = "data-dj-group-title-bar";
const GROUP_FONT_BAR_WIDTH = 236;
// Breathing room kept between the bar and ComfyUI's own selection toolbox.
const SELECTION_TOOLBOX_GAP = 6;
const DOUBLE_CLICK_SLOP = 6;
const DOUBLE_CLICK_TIME = 300;
const TITLE_ALIGNMENTS = new Set(["left", "center", "right"]);
const CUSTOM_GROUP_COLORS = [
    "#ffffff", "#d1d5db", "#9ca3af", "#6b7280", "#db8ab5", "#ddcf88", "#f472b6",
    "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#991b1b",
    "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#c2410c", "#7c2d12",
    "#fef08a", "#fde047", "#facc15", "#eab308", "#a16207", "#713f12",
    "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#15803d", "#14532d",
    "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#047857", "#064e3b",
    "#a5f3fc", "#67e8f9", "#22d3ee", "#06b6d4", "#0e7490", "#164e63",
    "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#a9bfd6", "#ec4899",
    "#c4b5fd", "#a78bfa", "#8b5cf6", "#3babe3", "#4f8fc4", "#be185d",
    "#f5d0fe", "#e879f9", "#d946ef", "#c58b5a", "#a96f45", "#831843",
    "#fbcfe8", "#f9a8d4",
];

function getTitleAlignment(group) {
    return TITLE_ALIGNMENTS.has(group?.title_align) ? group.title_align : "left";
}

function getSelectedOutermostGroups(group) {
    if (!group?.selected) return [group];
    const graphGroups = group.graph?.groups ?? group.graph?._groups ?? app.canvas?.graph?.groups ?? app.canvas?.graph?._groups;
    const selectedGroups = Array.isArray(graphGroups)
        ? graphGroups.filter((candidate) => candidate?.selected)
        : [];
    if (selectedGroups.length <= 1) return [group];
    const outermost = selectedGroups.filter((candidate) => (
        !selectedGroups.some((parent) => groupContainsGroup(parent, candidate))
    ));
    return outermost.length > 0 ? outermost : [group];
}

const getAlignmentTargetGroups = getSelectedOutermostGroups;

function createBatchFontSizeGroup(group) {
    const targets = getSelectedOutermostGroups(group);
    if (targets.length <= 1) return group;
    return new Proxy(group, {
        set(target, property, value) {
            if (property === "font_size") {
                const fontSize = Number(value);
                for (const selectedGroup of targets) {
                    selectedGroup.font_size = fontSize;
                    selectedGroup.setDirtyCanvas?.(true, true);
                }
                app.canvas?.setDirty?.(true, true);
                return true;
            }
            target[property] = value;
            return true;
        },
    });
}

function showTitleAlignmentMenu(_value, _options, event, parentMenu, group) {
    const ContextMenu = globalThis.LiteGraph?.ContextMenu;
    if (!ContextMenu || !group) return false;

    const currentAlignment = getTitleAlignment(group);
    const alignments = [
        { value: "left", content: `${currentAlignment === "left" ? "✓ " : ""}左对齐` },
        { value: "center", content: `${currentAlignment === "center" ? "✓ " : ""}居中` },
        { value: "right", content: `${currentAlignment === "right" ? "✓ " : ""}右对齐` },
    ];

    new ContextMenu(alignments, {
        event,
        parentMenu,
        node: group,
        callback: (item) => {
            const alignment = typeof item === "string" ? item : item?.value;
            if (!TITLE_ALIGNMENTS.has(alignment)) return;

            const graph = app.canvas?.graph;
            const targets = getAlignmentTargetGroups(group);
            if (!targets.some((target) => getTitleAlignment(target) !== alignment)) return;
            graph?.beforeChange?.();
            for (const target of targets) {
                target.title_align = alignment;
                target.setDirtyCanvas?.(true, true);
            }
            app.canvas?.setDirty?.(true, true);
            graph?.afterChange?.();
        },
    });
    return false;
}

function showGroupColorPreviewMenu(_value, _options, event, parentMenu, group) {
    const LiteGraph = globalThis.LiteGraph;
    const ContextMenu = LiteGraph?.ContextMenu;
    const Canvas = globalThis.LGraphCanvas ?? LiteGraph?.LGraphCanvas ?? app.canvas?.constructor;
    const nodeColors = Canvas?.node_colors;
    if (!ContextMenu || !group || !nodeColors) return false;

    const graph = group.graph ?? app.canvas?.graph;
    const targets = getSelectedOutermostGroups(group);
    const originalColors = new Map(targets.map((target) => [target, {
        had: Object.prototype.hasOwnProperty.call(target, "color"),
        value: target.color,
    }]));
    const originalColor = originalColors.get(group)?.value;
    let committed = false;

    const markDirty = () => {
        for (const target of targets) target.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
    };
    const applyPreview = (color) => {
        for (const target of targets) {
            if (color == null) delete target.color;
            else target.color = color;
        }
        markDirty();
    };
    const restoreOriginal = () => {
        for (const target of targets) {
            const original = originalColors.get(target);
            if (original?.had) target.color = original.value;
            else delete target.color;
        }
        markDirty();
    };

    let submenu;
    const commitColor = (color) => {
        // beforeChange must capture the real pre-menu value, not the last hover preview.
        restoreOriginal();
        graph?.beforeChange?.();
        for (const target of targets) {
            if (color == null) delete target.color;
            else target.color = color;
        }
        committed = true;
        markDirty();
        graph?.afterChange?.();
        submenu?.getTopMenu?.().close();
    };

    const values = [{
        value: null,
        content: "<span style='display: block; padding-left: 4px;'>无颜色</span>",
        __djGroupColor: null,
    }];
    for (const [name, colorOption] of Object.entries(nodeColors)) {
        if (/custom|自定义|🎨/i.test(name) || !colorOption?.groupcolor) continue;
        values.push({
            value: name,
            content: `<span style='display: block; color: #ddd; padding-left: 4px; border-left: 8px solid ${colorOption.color}; background-color:${colorOption.bgcolor}'>${name}</span>`,
            __djGroupColor: colorOption.groupcolor,
        });
    }

    submenu = new ContextMenu(values, {
        event,
        parentMenu,
        node: group,
        callback: (item) => {
            commitColor(item?.__djGroupColor ?? null);
        },
    });

    const originalClose = submenu.close.bind(submenu);
    submenu.close = (...args) => {
        if (!committed) restoreOriginal();
        panel?.remove();
        return originalClose(...args);
    };

    for (const entry of submenu.root.querySelectorAll(":scope > .litemenu-entry:not(.separator)")) {
        entry.addEventListener("pointerenter", () => {
            applyPreview(entry.value?.__djGroupColor ?? null);
        });
    }

    const panel = document.createElement("div");
    panel.dataset.djGroupTitleColorPalette = "true";
    Object.assign(panel.style, {
        position: "fixed",
        zIndex: "100001",
        width: "224px",
        padding: "10px",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        borderRadius: "5px",
        background: "rgba(31, 34, 42, 0.98)",
        boxShadow: "0 6px 22px rgba(0, 0, 0, 0.45)",
        boxSizing: "border-box",
    });

    const grid = document.createElement("div");
    Object.assign(grid.style, {
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: "4px",
    });
    for (const color of CUSTOM_GROUP_COLORS) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.title = color;
        Object.assign(swatch.style, {
            width: "24px",
            height: "24px",
            padding: "0",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: "3px",
            background: color,
            cursor: "pointer",
        });
        swatch.addEventListener("pointerenter", () => applyPreview(color));
        swatch.addEventListener("click", (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            commitColor(color);
        });
        grid.appendChild(swatch);
    }
    panel.appendChild(grid);

    const pickerLabel = document.createElement("label");
    pickerLabel.textContent = "自定义取色";
    Object.assign(pickerLabel.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        marginTop: "10px",
        color: "#d1d5db",
        font: "12px/1.2 Inter, sans-serif",
    });
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = /^#[0-9a-f]{6}$/i.test(String(originalColor)) ? originalColor : "#64748b";
    Object.assign(picker.style, {
        width: "92px",
        height: "30px",
        padding: "1px",
        border: "1px solid rgba(255, 255, 255, 0.25)",
        borderRadius: "4px",
        background: "transparent",
        cursor: "pointer",
    });
    picker.addEventListener("input", () => applyPreview(picker.value));
    picker.addEventListener("change", () => commitColor(picker.value));
    pickerLabel.appendChild(picker);
    panel.appendChild(pickerLabel);

    // Keep the palette outside the scrollable menu so it is not clipped, while
    // still treating it as part of the submenu for outside-click detection.
    const originalContainsNode = submenu.containsNode.bind(submenu);
    submenu.containsNode = (node, ...args) => (
        panel.contains(node) || originalContainsNode(node, ...args)
    );
    document.body.appendChild(panel);

    requestAnimationFrame(() => {
        const menuRect = submenu.root.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const right = menuRect.right + 6;
        const left = right + panelRect.width <= window.innerWidth - 8
            ? right
            : Math.max(8, menuRect.left - panelRect.width - 6);
        panel.style.left = `${left}px`;
        panel.style.top = `${Math.max(8, Math.min(menuRect.top, window.innerHeight - panelRect.height - 8))}px`;
    });

    return false;
}

function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let rgb = [0, 0, 0];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map((channel) => Math.round((channel + m) * 255));
}

function rgbToHsv(r, g, b) {
    const values = [r, g, b].map((value) => Math.max(0, Math.min(255, value)) / 255);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === values[0]) h = 60 * (((values[1] - values[2]) / delta) % 6);
        else if (max === values[1]) h = 60 * ((values[2] - values[0]) / delta + 2);
        else h = 60 * ((values[0] - values[1]) / delta + 4);
    }
    if (h < 0) h += 360;
    return [h, max === 0 ? 0 : delta / max, max];
}

function rgbToHex(rgb) {
    return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(color, fallback = [110, 231, 183]) {
    const match = String(color ?? "").match(/^#([0-9a-f]{6})$/i);
    if (!match) return fallback;
    return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function getCustomTitleColor(group, fallbackColor) {
    const saturation = Number(group?.title_color_saturation);
    const brightness = Number(group?.title_color_brightness);
    if (!Number.isFinite(saturation) || !Number.isFinite(brightness)) return null;

    const groupRgb = hexToRgb(group?.color, hexToRgb(fallbackColor));
    const [hue] = rgbToHsv(...groupRgb);
    return rgbToHex(hsvToRgb(
        hue,
        Math.max(0, Math.min(1, saturation)),
        Math.max(0, Math.min(1, brightness)),
    ));
}

function showTitleColorPickerMenu(_value, _options, event, parentMenu, group) {
    const ContextMenu = globalThis.LiteGraph?.ContextMenu;
    if (!ContextMenu || !group) return false;

    const graph = group.graph ?? app.canvas?.graph;
    const targets = getSelectedOutermostGroups(group);
    const groupRgb = hexToRgb(group.color, [110, 231, 183]);
    const [groupHue, groupSaturation, groupBrightness] = rgbToHsv(...groupRgb);
    const legacyRgb = hexToRgb(group.title_color, groupRgb);
    const [, legacySaturation, legacyBrightness] = rgbToHsv(...legacyRgb);
    const savedSaturation = Number(group.title_color_saturation);
    const savedBrightness = Number(group.title_color_brightness);
    const hadCustomTitleColor = Number.isFinite(savedSaturation) && Number.isFinite(savedBrightness);
    const hue = groupHue;
    let saturation = hadCustomTitleColor
        ? Math.max(0, Math.min(1, savedSaturation))
        : (/^#[0-9a-f]{6}$/i.test(String(group.title_color)) ? legacySaturation : groupSaturation);
    let brightness = hadCustomTitleColor
        ? Math.max(0, Math.min(1, savedBrightness))
        : (/^#[0-9a-f]{6}$/i.test(String(group.title_color)) ? legacyBrightness : groupBrightness);
    let currentColor = rgbToHex(hsvToRgb(hue, saturation, brightness));
    let changed = false;
    let changeStarted = false;

    const markDirty = () => {
        for (const target of targets) target.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
    };
    const beginChange = () => {
        if (changeStarted) return;
        graph?.beforeChange?.();
        changeStarted = true;
    };
    const preview = () => {
        beginChange();
        for (const target of targets) {
            target.title_color_saturation = saturation;
            target.title_color_brightness = brightness;
            delete target.title_color;
        }
        changed = true;
        markDirty();
    };

    const submenu = new ContextMenu([], { event, parentMenu, node: group });
    const originalClose = submenu.close.bind(submenu);
    submenu.close = (...args) => {
        if (changeStarted) graph?.afterChange?.();
        return originalClose(...args);
    };

    const panel = submenu.root;
    panel.textContent = "";
    Object.assign(panel.style, {
        width: "292px",
        minWidth: "292px",
        minHeight: "0",
        padding: "0",
        overflow: "hidden",
        borderRadius: "5px",
        background: "#333333",
    });

    const svCanvas = document.createElement("canvas");
    svCanvas.width = 292;
    svCanvas.height = 142;
    Object.assign(svCanvas.style, { display: "block", width: "292px", height: "142px", cursor: "crosshair" });
    panel.appendChild(svCanvas);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.innerHTML = '<span style="color:#f05278;font-size:15px">×</span><span>清除自定义标题色</span>';
    const clearBackground = rgbToHex(hsvToRgb(hue, 0.30, 0.34));
    const clearHoverBackground = rgbToHex(hsvToRgb(hue, 0.27, 0.42));
    Object.assign(clearButton.style, {
        display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
        width: "100%", height: "40px", margin: "0", padding: "0", border: "0",
        borderTop: "1px solid rgba(255,255,255,.12)", background: clearBackground,
        color: "rgba(255,255,255,.62)", cursor: "pointer", font: "12px Inter, sans-serif",
        transition: "background-color 120ms ease, color 120ms ease",
    });
    clearButton.addEventListener("pointerenter", () => {
        clearButton.style.background = clearHoverBackground;
        clearButton.style.color = "rgba(255,255,255,.82)";
    });
    clearButton.addEventListener("pointerleave", () => {
        clearButton.style.background = clearBackground;
        clearButton.style.color = "rgba(255,255,255,.62)";
    });
    panel.appendChild(clearButton);

    const drawSv = () => {
        const context = svCanvas.getContext("2d");
        if (!context) return;
        context.fillStyle = `hsl(${hue}, 100%, 50%)`;
        context.fillRect(0, 0, svCanvas.width, svCanvas.height);
        const white = context.createLinearGradient(0, 0, svCanvas.width, 0);
        white.addColorStop(0, "#fff");
        white.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = white;
        context.fillRect(0, 0, svCanvas.width, svCanvas.height);
        const black = context.createLinearGradient(0, 0, 0, svCanvas.height);
        black.addColorStop(0, "rgba(0,0,0,0)");
        black.addColorStop(1, "#000");
        context.fillStyle = black;
        context.fillRect(0, 0, svCanvas.width, svCanvas.height);
        context.strokeStyle = "#fff";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(saturation * svCanvas.width, (1 - brightness) * svCanvas.height, 7, 0, Math.PI * 2);
        context.stroke();
    };

    const syncFromHsv = () => {
        const rgb = hsvToRgb(hue, saturation, brightness);
        currentColor = rgbToHex(rgb);
        if (changed) preview();
        drawSv();
    };

    const clearTitleColor = () => {
        beginChange();
        for (const target of targets) {
            delete target.title_color_saturation;
            delete target.title_color_brightness;
            delete target.title_color;
            target.setDirtyCanvas?.(true, true);
        }
        saturation = groupSaturation;
        brightness = groupBrightness;
        currentColor = rgbToHex(groupRgb);
        changed = true;
        markDirty();
        drawSv();
    };

    let draggingSv = false;
    const updateSvFromPointer = (pointerEvent) => {
        const rect = svCanvas.getBoundingClientRect();
        saturation = Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / rect.width));
        brightness = 1 - Math.max(0, Math.min(1, (pointerEvent.clientY - rect.top) / rect.height));
        changed = true;
        syncFromHsv();
    };
    svCanvas.addEventListener("pointerdown", (pointerEvent) => {
        draggingSv = true;
        svCanvas.setPointerCapture?.(pointerEvent.pointerId);
        updateSvFromPointer(pointerEvent);
    });
    svCanvas.addEventListener("pointermove", (pointerEvent) => {
        if (draggingSv) updateSvFromPointer(pointerEvent);
    });
    svCanvas.addEventListener("pointerup", () => { draggingSv = false; });
    clearButton.addEventListener("click", clearTitleColor);

    drawSv();
    return false;
}

function getTitleHeight(group, fallback = 30) {
    const fontSize = Number(group.font_size);
    return Number.isFinite(fontSize) && fontSize > 0
        ? Math.max(fallback, fontSize * (fallback / DEFAULT_GROUP_FONT_SIZE))
        : fallback;
}

function getTitleMetrics(group, fallback = 30) {
    const height = getTitleHeight(group, fallback);
    return {
        height,
        top: group.pos[1],
        bottom: group.pos[1] + height,
        overflowBelow: Math.max(0, height - (Number(group.size?.[1]) || 0)),
    };
}

function groupContainsGroup(parent, child) {
    if (parent === child || !parent?.pos || !parent?.size || !child?.pos || !child?.size) {
        return false;
    }

    const parentLeft = Number(parent.pos[0]);
    const parentTop = Number(parent.pos[1]);
    const parentRight = parentLeft + Number(parent.size[0]);
    const parentBottom = parentTop + Number(parent.size[1]);
    const childLeft = Number(child.pos[0]);
    const childTop = Number(child.pos[1]);
    const childRight = childLeft + Number(child.size[0]);
    const childBottom = childTop + Number(child.size[1]);

    return [parentLeft, parentTop, parentRight, parentBottom, childLeft, childTop, childRight, childBottom]
        .every(Number.isFinite)
        && childLeft >= parentLeft
        && childTop >= parentTop
        && childRight <= parentRight
        && childBottom <= parentBottom
        && (childLeft > parentLeft
            || childTop > parentTop
            || childRight < parentRight
            || childBottom < parentBottom);
}

function fitGroupTitleAboveTopNode(group) {
    if (!group?.pos || !group?.size) return false;

    try {
        group.recomputeInsideNodes?.();
    } catch (error) {
        console.warn("[DJ_GroupTitle] failed to refresh nodes before fitting title", error);
    }

    const nodes = Array.isArray(group._nodes) ? group._nodes : [];
    const renderedTitleHeight = Number(group.titleHeight);
    const titleHeight = Number.isFinite(renderedTitleHeight) && renderedTitleHeight > 0
        ? renderedTitleHeight
        : getTitleHeight(group);

    const graphGroups = group.graph?.groups ?? group.graph?._groups;
    const parentLeft = Number(group.pos[0]);
    const parentTop = Number(group.pos[1]);
    const parentRight = parentLeft + Number(group.size[0]);
    const parentBottom = parentTop + Number(group.size[1]);
    const childGroups = Array.isArray(graphGroups)
        ? graphGroups.filter((child) => {
            if (child === group || !child?.pos || !child?.size) return false;
            const childLeft = Number(child.pos[0]);
            const childTop = Number(child.pos[1]);
            const childRight = childLeft + Number(child.size[0]);
            const childBottom = childTop + Number(child.size[1]);
            return Number.isFinite(childLeft)
                && Number.isFinite(childTop)
                && Number.isFinite(childRight)
                && Number.isFinite(childBottom)
                && childLeft >= parentLeft
                && childTop >= parentTop
                && childRight <= parentRight
                && childBottom <= parentBottom;
        })
        : [];

    const topChildGroupY = childGroups.reduce((top, child) => {
        const childTop = Number(child.pos[1]);
        return Number.isFinite(childTop) ? Math.min(top, childTop) : top;
    }, Infinity);

    if (nodes.length === 0 && !Number.isFinite(topChildGroupY)) {
        group.size[1] = titleHeight;
        return true;
    }

    const topNodeY = nodes.reduce((top, node) => {
        // LiteGraph node.pos[1] is below the node title bar. boundingRect[1]
        // represents the actual visible top edge that the group title must clear.
        const boundingTop = Number(node?.boundingRect?.[1]);
        const nodeY = Number.isFinite(boundingTop)
            ? boundingTop
            : Number(node?.pos?.[1]);
        return Number.isFinite(nodeY) ? Math.min(top, nodeY) : top;
    }, Infinity);
    const topContentY = Number.isFinite(topChildGroupY) ? topChildGroupY : topNodeY;
    if (!Number.isFinite(topContentY)) return false;

    const oldTop = Number(group.pos[1]);
    const oldHeight = Number(group.size[1]);
    if (!Number.isFinite(oldTop) || !Number.isFinite(oldHeight)) return false;

    const currentTitleBottom = oldTop + titleHeight;
    const currentGap = topContentY - currentTitleBottom;

    // Existing extra space is intentional. Only expand upward when the title
    // would leave less than the minimum gap to the topmost node/child group.
    if (currentGap >= GROUP_TITLE_NODE_GAP) return false;

    const missingGap = GROUP_TITLE_NODE_GAP - currentGap;
    const newTop = oldTop - missingGap;
    const newHeight = oldHeight + missingGap;
    if (!Number.isFinite(newTop) || !Number.isFinite(newHeight) || newHeight <= 0) return false;

    group.pos[1] = newTop;
    group.size[1] = newHeight;
    return true;
}

function getGroupConstructor() {
    const graph = app.canvas?.graph;
    const groups = graph?.groups ?? graph?._groups;
    const group = Array.isArray(groups) ? groups[0] : null;
    return group?.constructor ?? globalThis.LGraphGroup ?? globalThis.LiteGraph?.LGraphGroup;
}

function insertGroupOptionsNearTop(canvasOptions, groupOptions) {
    const firstSeparatorIndex = canvasOptions.findIndex((item) => item == null);
    if (firstSeparatorIndex >= 0) {
        return [
            ...canvasOptions.slice(0, firstSeparatorIndex + 1),
            ...groupOptions,
            null,
            ...canvasOptions.slice(firstSeparatorIndex + 1),
        ];
    }

    // The first three entries are ComfyUI's Add Node, Add Group and Paste items.
    const insertionIndex = Math.min(3, canvasOptions.length);
    return [
        ...canvasOptions.slice(0, insertionIndex),
        null,
        ...groupOptions,
        null,
        ...canvasOptions.slice(insertionIndex),
    ];
}

function isInsideGroupFontBar(target) {
    return typeof target?.closest === "function"
        && Boolean(target.closest(`[${GROUP_FONT_BAR_ATTR}]`));
}

function installFontSliderStyles() {
    if (document.getElementById("dj-group-title-bar-styles")) return;

    const style = document.createElement("style");
    style.id = "dj-group-title-bar-styles";
    style.textContent = [
        `[${GROUP_FONT_BAR_ATTR}] input::-webkit-outer-spin-button,`,
        `[${GROUP_FONT_BAR_ATTR}] input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }`,
    ].join("\n");
    document.head.appendChild(style);
}

function installFontSliderBar() {
    if (window[FONT_SLIDER_PATCH_FLAG]) return true;

    const canvas = app.canvas;
    const canvasElement = canvas?.canvas;
    if (!canvasElement) return false;

    installFontSliderStyles();

    // Canvas-space -> canvas-element CSS pixels. Prefers the public helper and
    // falls back to the drag/scale state so a frontend rename cannot silently
    // disable the bar.
    const toCanvasPoint = (point) => {
        if (typeof canvas.convertOffsetToCanvas === "function") {
            const converted = canvas.convertOffsetToCanvas(point);
            if (Array.isArray(converted)) return converted;
        }
        const ds = canvas.ds;
        const scale = Number(ds?.scale) || 1;
        const offsetX = Number(ds?.offset?.[0]) || 0;
        const offsetY = Number(ds?.offset?.[1]) || 0;
        return [(point[0] + offsetX) * scale, (point[1] + offsetY) * scale];
    };

    let panel = null;
    let sliderFill = null;
    let numberInput = null;
    let panelState = null;
    let drag = null;
    let frameHandle = 0;
    let pending = null;
    let lastTitleClick = null;

    const clampFontSize = (value) => {
        const numeric = Number(value);
        const base = Number.isFinite(numeric) ? numeric : DEFAULT_GROUP_FONT_SIZE;
        return Math.max(MIN_GROUP_FONT_SIZE, Math.min(MAX_GROUP_FONT_SIZE, Math.round(base)));
    };

    // ComfyUI's own selection toolbox is left alone: it floats over the selected
    // group exactly as it does without this plugin. Its wrapper is positioned by
    // two CSS custom properties, so the bar can read where the toolbox will
    // settle - even mid entrance transition - and step aside instead of hiding
    // it.
    const getSelectionToolboxRect = () => {
        const element = document.querySelector('[data-testid="selection-toolbox"]');
        if (!element) return null;
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        if (!width || !height) return null;

        const wrapper = element.parentElement;
        const style = wrapper ? window.getComputedStyle(wrapper) : null;
        const x = Number.parseFloat(style?.getPropertyValue("--tb-x") ?? "");
        const y = Number.parseFloat(style?.getPropertyValue("--tb-y") ?? "");
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { left: x, top: y, right: x + width, bottom: y + height };
        }

        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };

    const rectanglesOverlap = (a, b) => a.left < b.right
        && b.left < a.right
        && a.top < b.bottom
        && b.top < a.bottom;

    const getRenderedTitleHeight = (group) => {
        const rendered = Number(group?.titleHeight);
        return Number.isFinite(rendered) && rendered > 0 ? rendered : getTitleHeight(group);
    };

    const getAnchorFontSize = () => {
        const configured = Number(panelState?.anchorGroup?.font_size);
        return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GROUP_FONT_SIZE;
    };

    const syncSlider = (fontSize) => {
        const size = clampFontSize(fontSize);
        if (sliderFill) {
            const span = FONT_SLIDER_VISUAL_MAX - MIN_GROUP_FONT_SIZE;
            const ratio = span > 0 ? (size - MIN_GROUP_FONT_SIZE) / span : 0;
            sliderFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
        }
        if (numberInput && document.activeElement !== numberInput) {
            numberInput.value = String(size);
        }
    };

    // Recomputed from live canvas state on every frame, so zooming or panning
    // never leaves the bar stranded away from its group.
    const positionPanel = () => {
        const group = panelState?.anchorGroup;
        if (!panel || !group?.pos || !canvasElement.isConnected) return;

        const [localX, localY] = toCanvasPoint([
            Number(group.pos[0]) || 0,
            (Number(group.pos[1]) || 0) + getRenderedTitleHeight(group),
        ]);
        const canvasRect = canvasElement.getBoundingClientRect();
        const width = panel.offsetWidth || GROUP_FONT_BAR_WIDTH;
        const height = panel.offsetHeight || 34;
        const maxTop = Math.max(8, window.innerHeight - height - 8);
        // Flush with the group's left edge and the title's bottom edge, then
        // clamped so the bar stays reachable near the viewport borders.
        const left = Math.min(
            Math.max(8, canvasRect.left + localX),
            Math.max(8, window.innerWidth - width - 8),
        );
        let top = Math.min(Math.max(8, canvasRect.top + localY), maxTop);

        // Step around the official selection toolbox instead of covering it: the
        // gap above it wins, and the bar only drops below when the viewport has
        // no room left up there.
        const toolboxRect = getSelectionToolboxRect();
        if (toolboxRect && rectanglesOverlap(
            { left, top, right: left + width, bottom: top + height },
            toolboxRect,
        )) {
            const aboveToolbox = toolboxRect.top - height - SELECTION_TOOLBOX_GAP;
            const belowToolbox = toolboxRect.bottom + SELECTION_TOOLBOX_GAP;
            if (aboveToolbox >= 8) top = aboveToolbox;
            else if (belowToolbox <= maxTop) top = belowToolbox;
        }

        top = Math.min(Math.max(8, top), maxTop);
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
    };

    const follow = () => {
        if (!panelState) {
            frameHandle = 0;
            return;
        }
        positionPanel();
        frameHandle = window.requestAnimationFrame(follow);
    };

    const startFollow = () => {
        if (frameHandle) return;
        frameHandle = window.requestAnimationFrame(follow);
    };

    const stopFollow = () => {
        if (!frameHandle) return;
        window.cancelAnimationFrame(frameHandle);
        frameHandle = 0;
    };

    const beginGraphChange = () => {
        if (!panelState || panelState.changeStarted) return;
        panelState.graph?.beforeChange?.();
        panelState.changeStarted = true;
    };

    const endGraphChange = (fitTitles) => {
        const state = panelState;
        if (!state?.changeStarted) return;
        state.changeStarted = false;
        if (fitTitles) {
            for (const target of state.targets) {
                fitGroupTitleAboveTopNode(target);
                target.setDirtyCanvas?.(true, true);
            }
        }
        state.graph?.afterChange?.();
        canvas.setDirty?.(true, true);
        positionPanel();
    };

    const setFontSize = (value) => {
        const state = panelState;
        if (!state) return;
        const size = clampFontSize(value);
        if (!state.changeStarted) {
            // The native selection lands on pointerup, which can follow the bar
            // opening on a slow click, so re-derive targets at the first edit.
            state.targets = getSelectedOutermostGroups(state.anchorGroup);
        }
        const willChange = state.targets.some((target) => Number(target.font_size) !== size);
        if (!willChange) {
            syncSlider(size);
            return;
        }
        beginGraphChange();
        for (const target of state.targets) {
            target.font_size = size;
            target.setDirtyCanvas?.(true, true);
        }
        canvas.setDirty?.(true, true);
        syncSlider(size);
    };

    const commitNumberInput = () => {
        if (!panelState || !numberInput) return;
        const parsed = Number.parseFloat(numberInput.value);
        if (!Number.isFinite(parsed)) {
            syncSlider(getAnchorFontSize());
            return;
        }
        setFontSize(parsed);
    };

    const closePanel = (options) => {
        const commit = options?.commit !== false;
        if (panelState) {
            if (commit) commitNumberInput();
            endGraphChange(true);
        }
        drag = null;
        panelState = null;
        stopFollow();
        if (panel) panel.style.display = "none";
    };

    const ensurePanel = () => {
        if (panel?.isConnected) return;
        panel = document.createElement("div");
        panel.setAttribute(GROUP_FONT_BAR_ATTR, "true");
        Object.assign(panel.style, {
            position: "fixed",
            zIndex: "100002",
            display: "none",
            alignItems: "center",
            gap: "8px",
            width: `${GROUP_FONT_BAR_WIDTH}px`,
            padding: "7px 8px",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "6px",
            background: "rgba(31, 34, 42, 0.98)",
            boxShadow: "0 6px 22px rgba(0, 0, 0, 0.45)",
            boxSizing: "border-box",
            font: "12px/1.2 Inter, sans-serif",
        });

        const track = document.createElement("div");
        Object.assign(track.style, {
            position: "relative",
            flex: "1 1 auto",
            height: "18px",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "9px",
            background: "rgba(255, 255, 255, 0.08)",
            cursor: "ew-resize",
            overflow: "hidden",
            touchAction: "none",
            userSelect: "none",
        });

        sliderFill = document.createElement("div");
        Object.assign(sliderFill.style, {
            position: "absolute",
            left: "0",
            top: "0",
            bottom: "0",
            width: "0%",
            background: "rgba(110, 231, 183, 0.55)",
        });
        track.appendChild(sliderFill);

        numberInput = document.createElement("input");
        numberInput.type = "number";
        numberInput.min = String(MIN_GROUP_FONT_SIZE);
        numberInput.max = String(MAX_GROUP_FONT_SIZE);
        numberInput.step = "1";
        numberInput.title = "输入字号后回车生效";
        Object.assign(numberInput.style, {
            width: "56px",
            height: "22px",
            padding: "0 4px",
            border: "1px solid rgba(255, 255, 255, 0.20)",
            borderRadius: "4px",
            background: "rgba(0, 0, 0, 0.35)",
            color: "#ffffff",
            font: "12px/1 Inter, sans-serif",
            textAlign: "center",
            boxSizing: "border-box",
        });

        panel.append(track, numberInput);
        document.body.appendChild(panel);

        track.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || !panelState) return;
            event.preventDefault();
            event.stopPropagation();
            // Pointer capture keeps the gesture alive outside the bar bounds.
            track.setPointerCapture?.(event.pointerId);
            drag = {
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startFontSize: getAnchorFontSize(),
            };
        });

        track.addEventListener("pointermove", (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            const deltaX = event.clientX - drag.startClientX;
            setFontSize(drag.startFontSize + deltaX / FONT_SLIDER_PIXELS_PER_STEP);
        });

        const finishDrag = (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            drag = null;
            endGraphChange(true);
        };
        track.addEventListener("pointerup", finishDrag);
        track.addEventListener("pointercancel", finishDrag);

        numberInput.addEventListener("pointerdown", (event) => event.stopPropagation());
        numberInput.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
                event.preventDefault();
                commitNumberInput();
                endGraphChange(true);
                syncSlider(getAnchorFontSize());
            } else if (event.key === "Escape") {
                event.preventDefault();
                closePanel({ commit: false });
            }
        });
        numberInput.addEventListener("blur", () => {
            if (!panelState) return;
            commitNumberInput();
            endGraphChange(true);
        });
    };

    const openPanel = (group) => {
        if (!group) return;
        panelState = {
            anchorGroup: group,
            // Ctrl/Shift click adds to the selection before this runs, so the
            // bar follows the last added group while editing every selected one.
            targets: getSelectedOutermostGroups(group),
            graph: group.graph ?? canvas.graph,
            changeStarted: false,
        };
        ensurePanel();
        drag = null;
        syncSlider(getAnchorFontSize());
        panel.style.display = "flex";
        positionPanel();
        startFollow();
    };

    const cancelPending = () => {
        pending = null;
    };

    const getGroupTitleAtEvent = (event) => {
        const graph = canvas.graph;
        if (!graph) return null;
        const point = canvas.convertEventToCanvasOffset(event);
        if (!point) return null;
        // Nodes win over groups, exactly like the native hit test.
        if (graph.getNodeOnPos?.(point[0], point[1])) return null;
        return graph.getGroupTitlebarOnPos?.(point[0], point[1]) ?? null;
    };

    // Safety net for the additive title click. Ctrl/Cmd used to be swallowed by
    // the stock box-select branch, which releases without the canvas wrapper and
    // left every node inside the group selected - one toolbar per node. The
    // canvas patch now keeps Ctrl on the group branch; this drops the same
    // entries for any release that still escapes it, so a title gesture can only
    // ever leave groups behind.
    let additiveSelectionBefore = null;

    const armAdditiveSelectionCleanup = (event) => {
        if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
        const canvas = app.canvas;
        additiveSelectionBefore = {
            canvas,
            before: new Set(canvas?.selectedItems ?? []),
        };
    };

    const releaseAdditiveSelectionCleanup = () => {
        const armed = additiveSelectionBefore;
        additiveSelectionBefore = null;
        if (!armed) return;
        // The stock click is dispatched after this listener, so the cleanup has
        // to wait for the next task to see the selection it produced.
        window.setTimeout(() => {
            dropAddedSelection(armed.canvas, armed.before, isGroupItem);
        }, 0);
    };

    // Consumed on release. A drag leaves the click alone and keeps the groups
    // the user already selected; a real click runs the stock selection and the
    // group stays selected, exactly as it does without this plugin.
    const handlePointerUp = () => {
        const pressed = pending;
        pending = null;
        const dragged = Boolean(pressed?.moved);
        releaseAdditiveSelectionCleanup();
        if (!pressed) return;

        // The bar opens on the release itself - no timer in between - so it is
        // there the moment the title is clicked. A drag opens nothing: the bar is
        // for editing a title, not for carrying a group around the canvas.
        if (dragged) return;
        window.setTimeout(() => openPanel(pressed.group), 0);
    };

    const handlePointerDown = (event) => {
        if (isInsideGroupFontBar(event.target)) return;

        // A stale snapshot can only belong to a gesture that never released.
        additiveSelectionBefore = null;

        if (event.button !== 0) {
            cancelPending();
            return;
        }

        if (panelState) closePanel();

        if (event.altKey) {
            cancelPending();
            return;
        }

        const group = getGroupTitleAtEvent(event);
        if (!group) {
            cancelPending();
            return;
        }

        // Second click of a double click: the native title editor owns that
        // gesture, so the bar is closed instead of opened and the editor is left
        // alone. Recorded on every title press because the bar itself opens on
        // release, which leaves nothing armed to compare against. The window and
        // the drift are read from the canvas' own pointer so both agree on what
        // counts as a double click.
        const Pointer = canvas.pointer?.constructor;
        const doubleClickTime = Number(Pointer?.doubleClickTime) || DOUBLE_CLICK_TIME;
        const doubleClickDrift = (Number(Pointer?.maxClickDrift) || DOUBLE_CLICK_SLOP) * 3;
        const isDoubleClick = Boolean(lastTitleClick)
            && lastTitleClick.group === group
            && event.timeStamp - lastTitleClick.timeStamp <= doubleClickTime
            && ((event.clientX - lastTitleClick.clientX) ** 2
                + (event.clientY - lastTitleClick.clientY) ** 2) <= doubleClickDrift ** 2;
        lastTitleClick = {
            group,
            clientX: event.clientX,
            clientY: event.clientY,
            timeStamp: event.timeStamp,
        };
        if (isDoubleClick) {
            lastTitleClick = null;
            cancelPending();
            if (panelState) closePanel({ commit: true });
            return;
        }

        armAdditiveSelectionCleanup(event);
        pending = {
            group,
            clientX: event.clientX,
            clientY: event.clientY,
            moved: false,
        };
    };

    // Uses the canvas' own click drift, so "click" here means exactly what it
    // means to the stock canvas: anything past that drift starts a drag there and
    // is treated as a drag here too.
    const handlePointerMove = (event) => {
        if (!pending || pending.moved) return;
        const Pointer = canvas.pointer?.constructor;
        const drift = Number(Pointer?.maxClickDrift) || DOUBLE_CLICK_SLOP;
        const dx = event.clientX - pending.clientX;
        const dy = event.clientY - pending.clientY;
        if (dx * dx + dy * dy > drift * drift) pending.moved = true;
    };

    const handleKeyDown = (event) => {
        if (event.key !== "Escape") return;
        if (panelState) closePanel({ commit: false });
        else cancelPending();
    };

    const handleWindowBlur = () => {
        cancelPending();
        if (panelState) closePanel();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);

    window[FONT_SLIDER_PATCH_FLAG] = true;
    return true;
}

function isGroupItem(item) {
    const Group = getGroupConstructor();
    if (Group && item instanceof Group) return true;
    return Array.isArray(item?._nodes) && typeof item?.recomputeInsideNodes === "function";
}

// Drops the selection entries a group title gesture introduced, leaving behind
// anything the user already had selected. `before` is optional: without it every
// current entry counts as introduced. `keep` protects entries the gesture is
// allowed to select (groups, for Ctrl/Shift add-to-selection).
function dropAddedSelection(canvas, before, keep) {
    const selected = canvas?.selectedItems;
    if (!selected?.size) return;
    for (const item of Array.from(selected)) {
        if (before?.has(item) || keep?.(item)) continue;
        if (typeof canvas.deselect === "function") {
            canvas.deselect(item);
        } else {
            item.selected = false;
            selected.delete(item);
        }
    }
}

// Armed by a plain group title pointer down and consumed by the drag that may
// follow it. Dragging moves whatever is selected - _startDraggingItems selects
// the group itself to make that work - so the selection it creates is dropped
// again as soon as the move is over.
let groupTitleDragCleanup = null;

// Set while a title press is being dragged, so the drag can be recognised as a
// title drag even after the press itself is over. Cleared on every new primary
// press and when the drag ends.
let groupTitleDragGroup = null;

// The stock canvas matches Ctrl/Cmd before it looks for a group title: with
// "Comfy.Canvas.LeftMouseClickBehavior" set to `panning` it hands the press to
// its box-select branch and returns, so the group branch below - and with it the
// child cleanup - is never reached. The selection it builds then cascades into
// every node inside the group and one toolbar pops up per node. Shift already
// takes the group branch, so Ctrl/Cmd is presented to the stock handler with its
// own flag masked off and follows the very same route.
function maskCtrlModifier(event) {
    const masked = [];
    for (const property of ["ctrlKey", "metaKey"]) {
        try {
            Object.defineProperty(event, property, { configurable: true, value: false });
            masked.push(property);
        } catch (error) {
            console.warn("[DJ_GroupTitle] could not mask modifier", property, error);
        }
    }
    return () => {
        for (const property of masked) {
            try {
                delete event[property];
            } catch (error) {
                console.warn("[DJ_GroupTitle] could not restore modifier", property, error);
            }
        }
    };
}

function patchCanvasPrototype() {
    const Canvas = app.canvas?.constructor;
    const originalPrimaryButton = Canvas?.prototype?._processPrimaryButton;
    const originalDrawSnapGuide = Canvas?.prototype?.drawSnapGuide;
    const originalProcessContextMenu = Canvas?.prototype?.processContextMenu;
    if (!originalPrimaryButton || !originalDrawSnapGuide || !originalProcessContextMenu) {
        return false;
    }

    if (!originalPrimaryButton[CANVAS_PATCH_FLAG]) {
        function processPrimaryButtonWithGroupTitle(event, node, ...args) {
            // Re-armed on every pointer down so a stale cleanup can never fire.
            groupTitleDragCleanup = null;
            groupTitleDragGroup = null;
            const graph = this.graph;
            const x = Number(event?.canvasX);
            const y = Number(event?.canvasY);
            const group = Number.isFinite(x) && Number.isFinite(y)
                ? graph?.getGroupTitlebarOnPos?.(x, y)
                : null;

            const nodeAtPoint = Number.isFinite(x) && Number.isFinite(y)
                ? graph?.getNodeOnPos?.(x, y)
                : null;
            if (nodeAtPoint && nodeAtPoint !== group) {
                return originalPrimaryButton.call(this, event, nodeAtPoint, ...args);
            }

            if (!group) return originalPrimaryButton.call(this, event, node, ...args);

            // Ctrl and Shift must reach a group title the same way. Masking the
            // Ctrl/Cmd flag keeps the stock box-select shortcut out of the way,
            // so this press lands on the group branch exactly like a Shift press
            // does instead of leaving the whole child cascade selected.
            const unmaskCtrl = (event?.ctrlKey || event?.metaKey) && !event?.shiftKey
                ? maskCtrlModifier(event)
                : null;

            // When a short group's resize corner overlaps the enlarged title,
            // resizing must take priority over dragging the title bar.
            if (group.isInResize?.(x, y)) {
                try {
                    return originalPrimaryButton.call(this, event, undefined, ...args);
                } finally {
                    unmaskCtrl?.();
                }
            }

            // The current frontend checks a hard-coded 30px height later in this method.
            // Remap only the hit-test coordinate; drag events keep their real coordinates.
            const originalCanvasY = event.canvasY;
            // The native branch assigns selected_group only after its link and
            // reroute hit tests. Clearing it first tells us whether this call
            // really reached the group branch instead of returning early.
            const previousSelectedGroup = this.selected_group;
            this.selected_group = null;
            let result;
            try {
                event.canvasY = group.pos[1] + 1;
                result = originalPrimaryButton.call(this, event, undefined, ...args);
            } finally {
                event.canvasY = originalCanvasY;
                unmaskCtrl?.();
            }

            const nativeGroupHit = this.selected_group;
            if (nativeGroupHit == null) this.selected_group = previousSelectedGroup;
            if (nativeGroupHit !== group) return result;

            const additive = Boolean(event?.ctrlKey || event?.shiftKey || event?.metaKey);
            if (additive) {
                // Ctrl/Shift keeps the native "add to selection" so grouped font
                // editing still has visible highlights, but a group must never
                // pull its child nodes into the selection. This method only arms
                // the pointer: the real selection runs on click (pointer up), so
                // the cleanup has to wrap that callback instead of running here.
                // The window-level fallback in installFontSliderBar drops the
                // same entries when a stock branch releases without this wrapper.
                const canvas = this;
                const before = new Set(canvas.selectedItems ?? []);
                groupTitleDragCleanup = () => dropAddedSelection(canvas, before, isGroupItem);
                groupTitleDragGroup = group;
                const nativeOnClick = this.pointer?.onClick;
                if (typeof nativeOnClick !== "function") return result;
                this.pointer.onClick = (...clickArgs) => {
                    const outcome = nativeOnClick.apply(this, clickArgs);
                    dropAddedSelection(this, before, isGroupItem);
                    return outcome;
                };
                return result;
            }

            // A plain click on the title bar keeps the stock pointer.onClick, so
            // the native processSelect(group, e) still runs on release: the group
            // stays selected and ComfyUI's selection toolbox pops up over it just
            // like it does without this plugin. The bar is the one that moves -
            // positionPanel steps it around the toolbox.
            const canvas = this;
            const before = new Set(canvas.selectedItems ?? []);
            groupTitleDragGroup = group;
            // Dragging still needs the group selected, and _startDraggingItems
            // selects it once the pointer moves. Only what the drag itself adds is
            // dropped when the move ends, so the pre-drag selection survives and
            // can be dragged again.
            groupTitleDragCleanup = () => dropAddedSelection(canvas, before);
            return result;
        }

        processPrimaryButtonWithGroupTitle[CANVAS_PATCH_FLAG] = true;
        Canvas.prototype._processPrimaryButton = processPrimaryButtonWithGroupTitle;
    }

    // Optional patch: a missing _processDraggedItems must not block the rest.
    const originalDraggedItems = Canvas?.prototype?._processDraggedItems;
    if (originalDraggedItems && !originalDraggedItems[DRAG_END_PATCH_FLAG]) {
        function processDraggedItemsAfterGroupTitleDrag(event, ...args) {
            // Run the native handler first so snapping and onNodeMoved still see
            // the selection this drag needed, then release it.
            const result = originalDraggedItems.call(this, event, ...args);
            const cleanup = groupTitleDragCleanup;
            groupTitleDragCleanup = null;
            groupTitleDragGroup = null;
            cleanup?.();
            return result;
        }

        processDraggedItemsAfterGroupTitleDrag[DRAG_END_PATCH_FLAG] = true;
        Canvas.prototype._processDraggedItems = processDraggedItemsAfterGroupTitleDrag;
    }

    // Optional patch: while a title drag runs, Ctrl/Cmd must not change what the
    // drag moves. The stock canvas reads the modifier on every pointer move and
    // then moves the selected frames alone, leaving every node behind - so
    // selecting two groups with Ctrl and dragging one would move both frames but
    // none of their contents. A title drag therefore carries its contents for
    // Ctrl exactly like it already does for Shift and for an unmodified drag.
    const originalProcessMouseMove = Canvas?.prototype?.processMouseMove;
    if (originalProcessMouseMove && !originalProcessMouseMove[MOVE_PATCH_FLAG]) {
        function processMouseMoveWithTitleDrag(event, ...args) {
            if (!groupTitleDragGroup || !this.isDragging || !(event?.ctrlKey || event?.metaKey)) {
                return originalProcessMouseMove.call(this, event, ...args);
            }

            const unmaskCtrl = maskCtrlModifier(event);
            try {
                return originalProcessMouseMove.call(this, event, ...args);
            } finally {
                unmaskCtrl();
            }
        }

        processMouseMoveWithTitleDrag[MOVE_PATCH_FLAG] = true;
        Canvas.prototype.processMouseMove = processMouseMoveWithTitleDrag;
    }

    if (!originalDrawSnapGuide[SNAP_GUIDE_PATCH_FLAG]) {
        function drawSnapGuideWithDynamicTitle(context, item, ...args) {
            if (!item?.isPointInTitlebar || !item?.boundingRect || !item?.pos) {
                return originalDrawSnapGuide.call(this, context, item, ...args);
            }

            const metrics = getTitleMetrics(item);
            if (metrics.overflowBelow <= 0) {
                return originalDrawSnapGuide.call(this, context, item, ...args);
            }

            const bounds = item.boundingRect;
            const expandedItem = {
                pos: item.pos,
                boundingRect: [
                    bounds[0],
                    bounds[1],
                    bounds[2],
                    bounds[3] + metrics.overflowBelow,
                ],
            };
            return originalDrawSnapGuide.call(this, context, expandedItem, ...args);
        }

        drawSnapGuideWithDynamicTitle[SNAP_GUIDE_PATCH_FLAG] = true;
        Canvas.prototype.drawSnapGuide = drawSnapGuideWithDynamicTitle;
    }

    if (!originalProcessContextMenu[CONTEXT_MENU_PATCH_FLAG]) {
        function processContextMenuWithInlineGroup(node, event, ...args) {
            const x = Number(event?.canvasX);
            const y = Number(event?.canvasY);
            const group = Number.isFinite(x) && Number.isFinite(y)
                ? this.graph?.getGroupTitlebarOnPos?.(x, y)
                : null;
            const ContextMenu = globalThis.LiteGraph?.ContextMenu;
            if (!group || !ContextMenu) {
                return originalProcessContextMenu.call(this, node, event, ...args);
            }

            const canvasOptions = this.getCanvasMenuOptions?.();
            const groupOptions = group.getMenuOptions?.();
            if (!Array.isArray(canvasOptions) || !Array.isArray(groupOptions)) {
                return originalProcessContextMenu.call(this, node, event, ...args);
            }

            // Keep canvas callbacks unchanged while explicitly supplying the group
            // only to callbacks that previously lived in the Edit Group submenu.
            const inlineGroupOptions = groupOptions.map((item) => {
                if (!item || typeof item !== "object" || typeof item.callback !== "function") {
                    return item;
                }

                const isTitleColorMenu = item.__djTitleColor
                    || item.callback === showTitleColorPickerMenu;
                if (isTitleColorMenu) {
                    return {
                        ...item,
                        content: "标题色",
                        has_submenu: true,
                        callback(...callbackArgs) {
                            callbackArgs[4] = group;
                            return showTitleColorPickerMenu(...callbackArgs);
                        },
                    };
                }

                const isGroupColorMenu = item.__djGroupColor
                    || item.callback.name === "onMenuNodeColors";
                if (isGroupColorMenu) {
                    return {
                        ...item,
                        content: '<span style="display: block; color: #6ee7b7; padding-left: 4px">组颜色</span>',
                        callback(...callbackArgs) {
                            callbackArgs[4] = group;
                            return showGroupColorPreviewMenu(...callbackArgs);
                        },
                    };
                }

                const callbackGroup = item.property === "font_size"
                    ? createBatchFontSizeGroup(group)
                    : group;
                const originalCallback = item.callback;
                return {
                    ...item,
                    callback(...callbackArgs) {
                        callbackArgs[4] = callbackGroup;
                        return originalCallback.apply(this, callbackArgs);
                    },
                };
            });

            const menuInfo = insertGroupOptionsNearTop(canvasOptions, inlineGroupOptions);
            // ComfyUI closes the official group menu with a separator plus the
            // Edit Group submenu. Rebuilding the menu here would drop it, so it is
            // reproduced verbatim - same label, same submenu title, same source
            // (group.getMenuOptions()) - and stays the last entry, exactly where
            // the stock menu puts it.
            menuInfo.push(null, {
                content: "Edit Group",
                has_submenu: true,
                submenu: {
                    title: "Group",
                    extra: group,
                    options: groupOptions,
                },
            });
            new ContextMenu(menuInfo, { event });
        }

        processContextMenuWithInlineGroup[CONTEXT_MENU_PATCH_FLAG] = true;
        Canvas.prototype.processContextMenu = processContextMenuWithInlineGroup;
    }

    return true;
}

function syncTitleEditorFont(group) {
    const fontSize = Number(group?.font_size);
    if (!Number.isFinite(fontSize) || fontSize <= 0) return false;

    const editor = document.querySelector(".group-title-editor");
    if (!editor) return false;

    const scale = Number(app.canvas?.ds?.scale) || 1;
    const scaledFontSize = fontSize * scale;
    const alignment = getTitleAlignment(group);
    editor.style.fontSize = `${scaledFontSize}px`;
    editor.style.textAlign = alignment;
    const input = editor.querySelector('[data-testid="node-title-input"], input, textarea');
    if (input) {
        input.style.fontSize = `${scaledFontSize}px`;
        input.style.textAlign = alignment;
    }
    return true;
}

function installTitleEditorPatch() {
    if (window[EDITOR_PATCH_FLAG]) return;
    window[EDITOR_PATCH_FLAG] = true;

    document.addEventListener("litegraph:canvas", (event) => {
        if (event.detail?.subType !== "group-double-click") return;
        const group = event.detail.group;
        let attempts = 0;
        const updateEditor = () => {
            attempts += 1;
            if (!syncTitleEditorFont(group) && attempts < 8) {
                window.requestAnimationFrame(updateEditor);
            }
        };
        window.requestAnimationFrame(updateEditor);
    });
}

function patchGroupPrototype() {
    if (window[PATCH_FLAG]) return true;

    const Group = getGroupConstructor();
    if (!Group?.prototype?.draw) return false;

    const originalDraw = Group.prototype.draw;
    const originalResize = Group.prototype.resize;
    const originalSerialize = Group.prototype.serialize;
    const originalConfigure = Group.prototype.configure;
    const originalGetMenuOptions = Group.prototype.getMenuOptions;
    const titleHeightDescriptor = Object.getOwnPropertyDescriptor(Group.prototype, "titleHeight");
    const getOriginalTitleHeight = titleHeightDescriptor?.get;
    const originalIsPointInside = Group.prototype.isPointInside;
    const originalIsInResize = Group.prototype.isInResize;

    Object.defineProperty(Group.prototype, "titleHeight", {
        configurable: true,
        enumerable: titleHeightDescriptor?.enumerable ?? false,
        get() {
            const originalHeight = Number(getOriginalTitleHeight?.call(this)) || 30;
            return getTitleHeight(this, originalHeight);
        },
    });

    Group.prototype.isPointInTitlebar = function isPointInDynamicTitlebar(x, y) {
        const originalHeight = Number(getOriginalTitleHeight?.call(this)) || 30;
        const metrics = getTitleMetrics(this, originalHeight);
        return x >= this.pos[0]
            && x <= this.pos[0] + this.size[0]
            && y >= metrics.top
            && y <= metrics.bottom;
    };

    Group.prototype.isPointInside = function isPointInsideDynamicTitle(x, y) {
        return originalIsPointInside.call(this, x, y) || this.isPointInTitlebar(x, y);
    };

    if (originalIsInResize) {
        Group.prototype.isInResize = function isInDynamicResize(x, y) {
            if (originalIsInResize.call(this, x, y)) return true;

            const originalHeight = Number(getOriginalTitleHeight?.call(this)) || 30;
            const visibleHeight = Math.max(
                Number(this.size?.[1]) || 0,
                getTitleHeight(this, originalHeight),
            );
            if (visibleHeight <= (Number(this.size?.[1]) || 0)) return false;

            const right = this.pos[0] + this.size[0];
            const bottom = this.pos[1] + visibleHeight;
            const resizeLength = Number(this.constructor?.resizeLength) || 10;
            return x < right
                && y < bottom
                && x - right + (y - bottom) > -resizeLength;
        };
    }

    if (originalResize) {
        Group.prototype.resize = function resizeDownToTitle(width, height, ...args) {
            const result = originalResize.call(this, width, height, ...args);
            if (result === false || !this._size) return result;

            // The dynamic title is drawn independently from the stored group height,
            // so retaining the base title height is enough for title-only note groups.
            const minimumHeight = Number(getOriginalTitleHeight?.call(this)) || 30;
            const requestedHeight = Number(height);
            if (Number.isFinite(requestedHeight)) {
                this._size[1] = Math.max(minimumHeight, requestedHeight);
            }
            return result;
        };
    }

    Group.prototype.draw = function drawWithFontSize(canvas, context, ...args) {
        const originalFillText = context.fillText;
        const originalRect = context.rect;
        const group = this;
        const originalTitleHeight = Number(getOriginalTitleHeight?.call(group)) || 30;
        const titleMetrics = getTitleMetrics(group, originalTitleHeight);
        const titleHeight = titleMetrics.height;
        let rectCallIndex = 0;

        context.rect = function drawGroupRect(x, y, width, height) {
            rectCallIndex += 1;
            if (rectCallIndex === 1 && Math.abs(height - originalTitleHeight) < 0.01) {
                return originalRect.call(this, x, y, width, titleHeight);
            }
            // strokeShape() draws the selected-group outline with a third rect.
            // Extend it downward only when a title-only group is shorter than its title.
            if (rectCallIndex === 3 && group.selected && titleMetrics.overflowBelow > 0) {
                return originalRect.call(
                    this,
                    x,
                    y,
                    width,
                    height + titleMetrics.overflowBelow,
                );
            }
            return originalRect.apply(this, arguments);
        };

        context.fillText = function fillGroupTitle(text, ...textArgs) {
            const title = `${group.title ?? ""}`;
            const originalRenderedTitle = `${title}${group.pinned ? "📌" : ""}`;
            const configuredFontSize = Number(group.font_size);
            const fontSize = Number.isFinite(configuredFontSize) && configuredFontSize > 0
                ? configuredFontSize
                : DEFAULT_GROUP_FONT_SIZE;
            if (text === title || text === originalRenderedTitle) {
                const previousFont = context.font;
                const previousTextAlign = context.textAlign;
                const previousFillStyle = context.fillStyle;
                const fontFamily = previousFont.replace(/^\s*[-+]?\d*\.?\d+(?:px|pt|em|rem)\s*/i, "");
                const alignment = getTitleAlignment(group);
                const horizontalPadding = fontSize / 2;
                context.font = `${fontSize}px ${fontFamily || "Inter"}`;
                const customTitleColor = getCustomTitleColor(group, previousFillStyle);
                if (customTitleColor) {
                    context.fillStyle = customTitleColor;
                }
                if (textArgs.length >= 2) {
                    context.textAlign = alignment;
                    if (alignment === "center") {
                        textArgs[0] = group.pos[0] + group.size[0] / 2;
                    } else if (alignment === "right") {
                        textArgs[0] = group.pos[0] + group.size[0] - horizontalPadding;
                    } else {
                        textArgs[0] = group.pos[0] + horizontalPadding;
                    }
                    textArgs[1] = titleMetrics.top + titleHeight / 2 + 1;
                }
                try {
                    // Keep the pinned state and its interaction restrictions, but
                    // draw only the group title without the attention-grabbing pin.
                    return originalFillText.apply(this, [title, ...textArgs]);
                } finally {
                    context.font = previousFont;
                    context.textAlign = previousTextAlign;
                    context.fillStyle = previousFillStyle;
                }
            }
            return originalFillText.apply(this, [text, ...textArgs]);
        };

        try {
            return originalDraw.call(this, canvas, context, ...args);
        } finally {
            context.fillText = originalFillText;
            context.rect = originalRect;
        }
    };
    Group.prototype.draw.__djGroupTitleDrawPatched = true;

    if (originalGetMenuOptions) {
        Group.prototype.getMenuOptions = function getMenuOptionsWithTitleAlignment(...args) {
            const options = originalGetMenuOptions.apply(this, args);
            if (!Array.isArray(options)) {
                return options;
            }

            for (let index = 0; index < options.length; index += 1) {
                const item = options[index];
                if (!item || typeof item !== "object") continue;

                const content = String(item.content ?? "").trim().toLowerCase();
                const isOriginalTitleOption = item.property === "title"
                    || content === "title"
                    || content === "标题";
                if (isOriginalTitleOption && !item.__djTitleColor) {
                    options[index] = {
                        ...item,
                        content: "标题色",
                        has_submenu: true,
                        callback: showTitleColorPickerMenu,
                        __djTitleColor: true,
                    };
                    continue;
                }

                const isOriginalGroupColorOption = item.callback?.name === "onMenuNodeColors"
                    || content === "color"
                    || content === "颜色";
                if (isOriginalGroupColorOption && !item.__djGroupColor) {
                    options[index] = {
                        ...item,
                        content: '<span style="display: block; color: #6ee7b7; padding-left: 4px">组颜色</span>',
                        __djGroupColor: true,
                    };
                }
            }

            if (options.some((item) => item?.__djTitleAlignment)) {
                return options;
            }

            const alignmentOption = {
                content: "标题对齐",
                has_submenu: true,
                callback: showTitleAlignmentMenu,
                __djTitleAlignment: true,
            };
            const fontSizeIndex = options.findIndex((item) => item?.property === "font_size");
            options.splice(fontSizeIndex >= 0 ? fontSizeIndex + 1 : options.length, 0, alignmentOption);
            return options;
        };
    }

    if (originalSerialize) {
        Group.prototype.serialize = function serializeWithFontSize(...args) {
            const data = originalSerialize.apply(this, args);
            if (data && Number.isFinite(Number(this.font_size))) data.font_size = Number(this.font_size);
            if (data) data.title_align = getTitleAlignment(this);
            if (data) {
                delete data.title_color;
                const saturation = Number(this.title_color_saturation);
                const brightness = Number(this.title_color_brightness);
                if (Number.isFinite(saturation) && Number.isFinite(brightness)) {
                    data.title_color_saturation = Math.max(0, Math.min(1, saturation));
                    data.title_color_brightness = Math.max(0, Math.min(1, brightness));
                } else {
                    delete data.title_color_saturation;
                    delete data.title_color_brightness;
                }
            }
            return data;
        };
    }

    if (originalConfigure) {
        Group.prototype.configure = function configureWithFontSize(data, ...args) {
            const result = originalConfigure.call(this, data, ...args);
            if (data && data.font_size != null) this.font_size = Number(data.font_size);
            this.title_align = getTitleAlignment(data);
            const saturation = Number(data?.title_color_saturation);
            const brightness = Number(data?.title_color_brightness);
            if (Number.isFinite(saturation) && Number.isFinite(brightness)) {
                this.title_color_saturation = Math.max(0, Math.min(1, saturation));
                this.title_color_brightness = Math.max(0, Math.min(1, brightness));
            } else if (/^#[0-9a-f]{6}$/i.test(String(data?.title_color))) {
                const [, legacySaturation, legacyBrightness] = rgbToHsv(...hexToRgb(data.title_color));
                this.title_color_saturation = legacySaturation;
                this.title_color_brightness = legacyBrightness;
            } else {
                delete this.title_color_saturation;
                delete this.title_color_brightness;
            }
            delete this.title_color;
            return result;
        };
    }

    window[PATCH_FLAG] = true;
    app.canvas?.setDirty?.(true, true);
    console.info("[DJ_GroupTitle] group title font size compatibility enabled");
    return true;
}

app.registerExtension({
    name: "dajiangtools.group_title",
    setup() {
        installTitleEditorPatch();
        const installRuntimePatches = () => {
            const groupPatched = patchGroupPrototype();
            const canvasPatched = patchCanvasPrototype();
            const fontSliderPatched = installFontSliderBar();
            return groupPatched && canvasPatched && fontSliderPatched;
        };
        if (installRuntimePatches()) return;
        const timer = window.setInterval(() => {
            if (installRuntimePatches()) window.clearInterval(timer);
        }, 250);
    },
});
