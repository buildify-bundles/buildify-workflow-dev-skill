#!/usr/bin/env node
/**
 * 按控制台「自动排列」重排 flow.json 的坐标。
 *
 *   node scripts/layout.mjs flow.json [--direction TB|LR] [-o out.json] [--check]
 *
 * 布局函数与控制台 composables/applyLayout.js、edges/routingMetrics.js 逐行对应，
 * 改动常量或流程时两边一起改，否则脚本排出的画布和控制台点「自动排列」不一致。
 *
 * 退出码：0 成功；1 --check 发现坐标需要变化；3 文件或图结构有问题。
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const dagre = require('./vendor/dagre.min.js')

// ---------------------------------------------------------------------------
// routingMetrics.js
// ---------------------------------------------------------------------------

const LOOP_METRICS = {
  obstaclePadding: 20,
  loopLead: 22,
  laneGap: 14,
  loopMargin: 28,
  groupClearance: 18,
  loopGroupGap: 32,
}

const LOOP_LEVEL_LEAD = 6
const INSET_SLACK = 2

function flowAxes(vertical) {
  return vertical
    ? { lo: 'top', hi: 'bottom', crossLo: 'left', crossHi: 'right' }
    : { lo: 'left', hi: 'right', crossLo: 'top', crossHi: 'bottom' }
}

function isBackward(sourceRect, targetRect, axes) {
  return targetRect[axes.lo] < sourceRect[axes.lo] - 0.5
}

function rectBounds(rects) {
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  }
}

function loopLeadClearance(level) {
  return LOOP_METRICS.loopLead + Math.min(level, 3) * LOOP_LEVEL_LEAD + LOOP_METRICS.loopGroupGap
}

function loopChannelClearance(level) {
  return LOOP_METRICS.obstaclePadding
    + LOOP_METRICS.loopMargin
    + level * LOOP_METRICS.laneGap
    + LOOP_METRICS.loopGroupGap
}

function getGroupLoopInsets({ rects = [], edges = [], vertical = true, bounds } = {}) {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  if (!rects.length || !edges.length) return insets
  const axes = flowAxes(vertical)
  const rectById = new Map(rects.map((rect) => [rect.id, rect]))
  const content = bounds ?? rectBounds(rects)
  const loops = []
  for (const edge of edges) {
    const source = rectById.get(edge?.source)
    const target = rectById.get(edge?.target)
    if (!source || !target || source === target || !isBackward(source, target, axes)) continue
    loops.push({ id: String(edge.id ?? `${edge.source}\0${edge.target}`), source, target, band: [target[axes.lo], source[axes.hi]] })
  }
  if (!loops.length) return insets

  const contentCenter = (content[axes.crossLo] + content[axes.crossHi]) / 2
  const crossCenter = (rect) => (rect[axes.crossLo] + rect[axes.crossHi]) / 2
  const need = (side, value) => {
    insets[side] = Math.max(insets[side], Math.ceil(value + INSET_SLACK))
  }

  for (const loop of loops) {
    const length = loop.band[1] - loop.band[0]
    let level = 0
    for (const other of loops) {
      if (other === loop) continue
      if (!(loop.band[0] <= other.band[1] && other.band[0] <= loop.band[1])) continue
      const otherLength = other.band[1] - other.band[0]
      if (otherLength < length || (otherLength === length && other.id.localeCompare(loop.id) < 0)) level += 1
    }

    const lean = (crossCenter(loop.source) + crossCenter(loop.target)) / 2 - contentCenter
    const low = vertical && lean < -1
    need(low ? axes.crossLo : axes.crossHi, loopChannelClearance(level))

    const lead = loopLeadClearance(level)
    need(axes.hi, lead - (content[axes.hi] - loop.source[axes.hi]))
    need(axes.lo, lead - (loop.target[axes.lo] - content[axes.lo]))
  }
  return insets
}

// ---------------------------------------------------------------------------
// applyLayout.js
// ---------------------------------------------------------------------------

const DEFAULT_NODE_WIDTH = 248
const DEFAULT_NODE_HEIGHT = 63

const GROUP_PAD_X = 24
const GROUP_PAD_TOP = 68
const GROUP_PAD_BOTTOM = 24
const GROUP_TITLE_OVERHANG = 0
const GROUP_MIN_WIDTH = 240
const GROUP_MIN_HEIGHT = 112
const DECORATION_TYPES = new Set(['text', 'comment', 'notes'])

function parseDim(value, fallback) {
  if (value == null || value === '') return fallback
  const number = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/px$/i, ''))
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function resolveDim(values, fallback) {
  for (const value of values) {
    const parsed = parseDim(value, 0)
    if (parsed > 0) return parsed
  }
  return fallback
}

function getNodeSize(node, fallback = {}) {
  const fallbackWidth = fallback.width ?? DEFAULT_NODE_WIDTH
  const fallbackHeight = fallback.height ?? DEFAULT_NODE_HEIGHT
  return {
    w: resolveDim(
      [node?.dimensions?.width, node?.style?.width, node?.width],
      fallbackWidth,
    ),
    h: resolveDim(
      [node?.dimensions?.height, node?.style?.height, node?.height],
      fallbackHeight,
    ),
  }
}

function nodeSizeFallback(node) {
  if (node?.type === 'group') {
    return { width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT }
  }
  if (DECORATION_TYPES.has(node?.type)) {
    return { width: 120, height: 72 }
  }
  return {}
}

function isLayoutableNode(node) {
  if (!node?.id || DECORATION_TYPES.has(node.type)) return false
  return !(
    node.layout === false
    || node.layoutDisabled === true
    || node.disableLayout === true
    || node.data?.layout === false
    || node.data?.layoutDisabled === true
    || node.data?.disableLayout === true
  )
}

function setNodeSize(node, width, height, writeStyle = node.type === 'group') {
  node.width = width
  node.height = height
  node.dimensions = { ...node.dimensions, width, height }
  if (writeStyle) {
    node.style = {
      ...(node.style && typeof node.style === 'object' ? node.style : {}),
      width: `${width}px`,
      height: `${height}px`,
    }
  }
}

function setHandlePositions(node, direction, sourcePosition, targetPosition) {
  if (node.type === 'group' || DECORATION_TYPES.has(node.type)) return
  if (direction === 'LR') {
    node.sourcePosition = 'right'
    node.targetPosition = 'left'
  } else if (direction === 'RL') {
    node.sourcePosition = 'left'
    node.targetPosition = 'right'
  } else if (direction === 'BT') {
    node.sourcePosition = 'top'
    node.targetPosition = 'bottom'
  } else {
    node.sourcePosition = String(sourcePosition || 'bottom')
    node.targetPosition = String(targetPosition || 'top')
  }
}

function createHierarchy(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const childrenByParent = new Map()
  const parentOf = new Map()

  for (const node of nodes) {
    const parentId = node.parentNode
    const validParent = parentId && parentId !== node.id && byId.get(parentId)?.type === 'group'
      ? parentId
      : null
    parentOf.set(node.id, validParent)
    const key = validParent || null
    if (!childrenByParent.has(key)) childrenByParent.set(key, [])
    childrenByParent.get(key).push(node)
  }

  return { byId, childrenByParent, parentOf }
}

const FANOUT_SPREAD_AFTER = 2

function isHorizontalDir(direction) {
  return direction === 'LR' || direction === 'RL'
}

function isGroupType(node) {
  return node?.type === 'group'
}

function getOutDegrees(scopeEdges) {
  const outDegree = new Map()
  let maxFanout = 0
  for (const edge of scopeEdges) {
    const next = (outDegree.get(edge.source) || 0) + 1
    outDegree.set(edge.source, next)
    maxFanout = Math.max(maxFanout, next)
  }
  return { outDegree, maxFanout }
}

function baseRankSeparation(direction) {
  return isHorizontalDir(direction) ? 140 : 90
}

function fanoutRankSeparation(direction, outDegree) {
  if (outDegree < 2) return baseRankSeparation(direction)
  const horizontal = isHorizontalDir(direction)
  if (horizontal) return outDegree <= FANOUT_SPREAD_AFTER ? 140 : 170
  return outDegree <= FANOUT_SPREAD_AFTER ? 120 : 136
}

function rankExtent(node, horizontal) {
  const { w, h } = getNodeSize(node)
  if (horizontal) return w
  return h + (isGroupType(node) ? GROUP_TITLE_OVERHANG : 0)
}

function rankLead(node, horizontal) {
  const origin = node.position?.[horizontal ? 'x' : 'y'] ?? 0
  if (!horizontal && isGroupType(node)) return origin - GROUP_TITLE_OVERHANG
  return origin
}

function groupUnitsByRank(units, direction) {
  const horizontal = isHorizontalDir(direction)
  const axis = horizontal ? 'x' : 'y'
  const byRank = new Map()
  for (const node of units) {
    const center = Math.round(rankLead(node, horizontal) + rankExtent(node, horizontal) / 2)
    if (!byRank.has(center)) byRank.set(center, [])
    byRank.get(center).push(node)
  }
  return { horizontal, axis, byRank, centers: [...byRank.keys()].sort((a, b) => a - b) }
}

function respaceRanks(units, outDegree, direction) {
  const { axis, byRank, centers } = groupUnitsByRank(units, direction)
  if (centers.length < 2) return

  const base = baseRankSeparation(direction)
  let shift = 0
  for (let i = 1; i < centers.length; i++) {
    let needed = base
    for (const node of byRank.get(centers[i - 1])) {
      const degree = isGroupType(node) ? 0 : (outDegree.get(node.id) || 0)
      needed = Math.max(needed, fanoutRankSeparation(direction, degree))
    }
    shift += needed - base
    if (!shift) continue
    for (const node of byRank.get(centers[i])) {
      node.position = { ...node.position, [axis]: (node.position?.[axis] ?? 0) + shift }
    }
  }
}

function alignRankStart(units, direction) {
  if (units.length < 2) return
  const { horizontal, byRank } = groupUnitsByRank(units, direction)
  const startAxis = horizontal ? 'x' : 'y'
  for (const row of byRank.values()) {
    if (row.length < 2) continue
    const start = Math.min(...row.map(node => node.position?.[startAxis] ?? 0))
    for (const node of row) {
      const current = node.position?.[startAxis] ?? 0
      if (current === start) continue
      node.position = { ...node.position, [startAxis]: start }
    }
  }
}

function crossAxisSeparation(direction, maxFanout, maxWidth, maxHeight) {
  const dense = maxFanout > FANOUT_SPREAD_AFTER
  if (isHorizontalDir(direction)) {
    return dense ? 56 : Math.min(96, Math.max(72, Math.round(maxHeight * 1.15)))
  }
  return dense
    ? Math.max(40, Math.round(maxWidth * 0.16))
    : Math.min(72, Math.max(48, Math.round(maxWidth * 0.2)))
}

function typicalNodeSize(nodes) {
  const sample = nodes.filter(node => !isGroupType(node))
  let maxWidth = 0
  let maxHeight = 0
  for (const node of sample) {
    const { w, h } = getNodeSize(node)
    maxWidth = Math.max(maxWidth, w)
    maxHeight = Math.max(maxHeight, h)
  }
  return {
    maxWidth: maxWidth > 0 ? maxWidth : DEFAULT_NODE_WIDTH,
    maxHeight: maxHeight > 0 ? maxHeight : DEFAULT_NODE_HEIGHT,
  }
}

function computeSeparations(nodes, direction, maxFanout = 0) {
  const { maxWidth, maxHeight } = typicalNodeSize(nodes)
  return {
    ranksep: baseRankSeparation(direction),
    nodesep: crossAxisSeparation(direction, maxFanout, maxWidth, maxHeight),
  }
}

function directChildForScope(nodeId, scopeId, hierarchy) {
  let current = hierarchy.byId.get(nodeId)
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const parentId = hierarchy.parentOf.get(current.id)
    if (parentId === scopeId) return current
    if (!parentId) return scopeId == null ? current : null
    current = hierarchy.byId.get(parentId)
  }
  return null
}

function getScopeEdges(scopeId, units, edges, hierarchy) {
  const unitIds = new Set(units.map(node => node.id))
  const seen = new Set()
  const result = []
  for (const edge of edges) {
    const source = directChildForScope(edge?.source, scopeId, hierarchy)
    const target = directChildForScope(edge?.target, scopeId, hierarchy)
    if (!source || !target || source.id === target.id) continue
    if (!unitIds.has(source.id) || !unitIds.has(target.id)) continue
    const key = `${source.id}\0${target.id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ source: source.id, target: target.id })
  }
  return result
}

function connectedComponents(units, edges) {
  const parent = new Map(units.map(node => [node.id, node.id]))
  function find(id) {
    let root = parent.get(id)
    while (root && root !== parent.get(root)) {
      root = parent.get(root)
    }
    return root
  }
  function union(a, b) {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA && rootB && rootA !== rootB) {
      parent.set(rootA, rootB)
    }
  }
  for (const edge of edges) {
    union(edge.source, edge.target)
  }
  const groups = new Map()
  for (const node of units) {
    const root = find(node.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(node)
  }
  return [...groups.values()]
}

function componentOrderKey(nodes, direction) {
  const axis = isHorizontalDir(direction) ? 'y' : 'x'
  return Math.min(...nodes.map(node => node.position?.[axis] ?? 0))
}

function boundsOf(nodes) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const { w, h } = getNodeSize(node)
    const x = node.position?.x ?? 0
    const y = node.position?.y ?? 0
    const top = y - (isGroupType(node) ? GROUP_TITLE_OVERHANG : 0)
    minX = Math.min(minX, x)
    minY = Math.min(minY, top)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }
  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function shiftNodes(nodes, dx, dy) {
  if (!dx && !dy) return
  for (const node of nodes) {
    node.position = {
      x: (node.position?.x ?? 0) + dx,
      y: (node.position?.y ?? 0) + dy,
    }
  }
}

/**
 * 按给定的交叉轴上限，把几段依次排进若干排：排内沿交叉轴并排，放不下就沿流向另起一排。
 * 只计算各段的偏移，不移动节点。
 */
function shelfPlacements(boxes, horizontal, limit, gap, shelfGap) {
  const placements = []
  let shelfStart = 0
  let shelfDepth = 0
  let cursor = 0
  let width = 0
  let height = 0
  for (const box of boxes) {
    const cross = horizontal ? box.height : box.width
    const depth = horizontal ? box.width : box.height
    if (cursor > 0 && cursor + cross > limit) {
      shelfStart += shelfDepth + shelfGap
      shelfDepth = 0
      cursor = 0
    }
    placements.push(horizontal ? { x: shelfStart, y: cursor } : { x: cursor, y: shelfStart })
    cursor += cross + gap
    shelfDepth = Math.max(shelfDepth, depth)
    const right = horizontal ? shelfStart + depth : cursor - gap
    const bottom = horizontal ? cursor - gap : shelfStart + depth
    width = Math.max(width, right)
    height = Math.max(height, bottom)
  }
  return { placements, width, height }
}

/**
 * 互不连线的几段沿交叉轴并排，避免高分组把另一段的后续节点顶开。
 * 并排过长时分成几排，让整体接近目标宽高比。
 */
function packComponents(components, direction, originX, originY, gap) {
  const horizontal = isHorizontalDir(direction)
  const boxes = components.map(boundsOf)
  const shelfGap = wrapGap(direction)
  const crossSizes = boxes.map(box => (horizontal ? box.height : box.width))
  const total = crossSizes.reduce((sum, size) => sum + size, 0) + gap * (boxes.length - 1)
  const widest = Math.max(...crossSizes)

  let best = null
  for (let shelves = 1; shelves <= boxes.length; shelves++) {
    const limit = Math.max(widest, total / shelves)
    const layout = shelfPlacements(boxes, horizontal, limit, gap, shelfGap)
    if (!layout.height) continue
    const score = Math.abs(Math.log(layout.width / layout.height / WRAP_ASPECT))
    if (!best || score < best.score - 1e-6) best = { ...layout, score }
  }
  if (!best) return

  components.forEach((nodes, index) => {
    const box = boxes[index]
    const place = best.placements[index]
    shiftNodes(nodes, originX + place.x - box.minX, originY + place.y - box.minY)
  })
}

/** 折行后整体宽高比的目标值，接近常见屏幕 */
const WRAP_ASPECT = 1.6
/** 层数少于此值不折行，小流程保持原样 */
const WRAP_MIN_BANDS = 6
/** 每段至少保留的层数，避免切出只有一两个节点的碎段 */
const WRAP_MIN_BANDS_PER_SEGMENT = 3

/** 段与段之间留给换行连线和标签的距离 */
function wrapGap(direction) {
  return isHorizontalDir(direction) ? 120 : 160
}

/**
 * 沿流向把节点归成层。同一层的节点在流向上互相重叠，层与层之间有空隙；
 * 按区间合并而不是按中心分组，同层节点尺寸不一时也不会被拆开。
 */
function flowBands(units, horizontal) {
  const items = units
    .map((node) => {
      const lead = rankLead(node, horizontal)
      return { node, lead, end: lead + rankExtent(node, horizontal) }
    })
    .sort((a, b) => a.lead - b.lead)
  const bands = []
  for (const item of items) {
    const last = bands[bands.length - 1]
    if (last && item.lead < last.end) {
      last.nodes.push(item.node)
      last.end = Math.max(last.end, item.end)
    } else {
      bands.push({ nodes: [item.node], start: item.lead, end: item.end })
    }
  }
  return bands
}

/** 按段数估算折行后的宽高比（段间距计入交叉轴），选最接近目标比例的段数 */
function wrapSegmentCount(length, crossLength, horizontal, bandCount, gap) {
  if (bandCount < WRAP_MIN_BANDS || length <= 0 || crossLength <= 0) return 1
  const maxCount = Math.floor(bandCount / WRAP_MIN_BANDS_PER_SEGMENT)
  let best = 1
  let bestScore = Infinity
  for (let count = 1; count <= maxCount; count++) {
    const flowSize = length / count
    const crossSize = count * crossLength + (count - 1) * gap
    const ratio = horizontal ? flowSize / crossSize : crossSize / flowSize
    const score = Math.abs(Math.log(ratio / WRAP_ASPECT))
    if (score < bestScore) {
      best = count
      bestScore = score
    }
  }
  return best
}

/** 落在第 index 层之后的空隙里、被切断的连线条数 */
function edgesAcrossGap(bands, index, bandOf, scopeEdges) {
  let count = 0
  for (const edge of scopeEdges) {
    const from = bandOf.get(edge.source)
    const to = bandOf.get(edge.target)
    if (from == null || to == null) continue
    if (Math.min(from, to) <= index && Math.max(from, to) > index) count++
  }
  return count
}

/**
 * 在 [min, max] 层间空隙里选最接近目标位置的切点，
 * 前后一层内跨线更少的空隙优先，尽量不把一组扇出拆到两段。
 */
function pickCut(bands, target, min, max, bandOf, scopeEdges) {
  let nearest = min
  let nearestDistance = Infinity
  for (let i = min; i <= max; i++) {
    const position = (bands[i].end + bands[i + 1].start) / 2
    const distance = Math.abs(position - target)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = i
    }
  }
  let best = nearest
  let bestCross = edgesAcrossGap(bands, nearest, bandOf, scopeEdges)
  for (const i of [nearest - 1, nearest + 1]) {
    if (i < min || i > max) continue
    const cross = edgesAcrossGap(bands, i, bandOf, scopeEdges)
    if (cross < bestCross) {
      best = i
      bestCross = cross
    }
  }
  return best
}

/**
 * 长链折行：Dagre 排成一条后，按层切成几段，每段平移回起点并沿交叉轴错开。
 * 横排超长换到下一行，竖排超长换到下一列，每段仍沿原方向走。
 */
function wrapLongFlow(units, scopeEdges, direction) {
  if (direction !== 'LR' && direction !== 'TB') return
  const horizontal = isHorizontalDir(direction)
  const bands = flowBands(units, horizontal)
  if (bands.length < WRAP_MIN_BANDS) return

  const box = boundsOf(units)
  const length = horizontal ? box.width : box.height
  const crossLength = horizontal ? box.height : box.width
  const gap = wrapGap(direction)
  const count = wrapSegmentCount(length, crossLength, horizontal, bands.length, gap)
  if (count < 2) return

  const bandOf = new Map()
  bands.forEach((band, index) => {
    for (const node of band.nodes) bandOf.set(node.id, index)
  })

  const origin = bands[0].start
  const cuts = []
  for (let i = 1; i < count; i++) {
    const min = (cuts.length ? cuts[cuts.length - 1] : -1) + WRAP_MIN_BANDS_PER_SEGMENT
    const max = bands.length - 1 - WRAP_MIN_BANDS_PER_SEGMENT * (count - i)
    if (min > max) break
    cuts.push(pickCut(bands, origin + (length * i) / count, min, max, bandOf, scopeEdges))
  }
  if (!cuts.length) return

  const segments = []
  let from = 0
  for (const cut of [...cuts, bands.length - 1]) {
    segments.push(bands.slice(from, cut + 1))
    from = cut + 1
  }

  const flowAxis = horizontal ? 'x' : 'y'
  const crossAxis = horizontal ? 'y' : 'x'
  let crossCursor = null
  for (const segment of segments) {
    const nodes = segment.flatMap(band => band.nodes)
    const flowShift = origin - segment[0].start
    const segmentBox = boundsOf(nodes)
    const crossMin = horizontal ? segmentBox.minY : segmentBox.minX
    const crossSize = horizontal ? segmentBox.height : segmentBox.width
    const crossShift = crossCursor == null ? 0 : crossCursor - crossMin
    for (const node of nodes) {
      node.position = {
        ...node.position,
        [flowAxis]: (node.position?.[flowAxis] ?? 0) + flowShift,
        [crossAxis]: (node.position?.[crossAxis] ?? 0) + crossShift,
      }
    }
    crossCursor = crossMin + crossShift + crossSize + gap
  }
}

function layoutGraph(units, scopeEdges, direction, marginx, marginy) {
  if (!units.length) return false
  const { outDegree, maxFanout } = getOutDegrees(scopeEdges)
  const graph = new dagre.graphlib.Graph()
  const { ranksep, nodesep } = computeSeparations(units, direction, maxFanout)
  graph.setGraph({
    rankdir: direction,
    ranksep,
    nodesep,
    edgesep: 10,
    marginx,
    marginy,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  const horizontal = isHorizontalDir(direction)
  const titleTop = node => (isGroupType(node) ? GROUP_TITLE_OVERHANG : 0)
  const titleBottom = node => (horizontal && isGroupType(node) ? GROUP_TITLE_OVERHANG : 0)
  for (const node of units) {
    const { w, h } = getNodeSize(node)
    graph.setNode(node.id, { width: w, height: h + titleTop(node) + titleBottom(node) })
  }
  for (const edge of scopeEdges) {
    graph.setEdge(edge.source, edge.target)
  }

  try {
    dagre.layout(graph)
  } catch (error) {
    console.warn('[layout] dagre.layout failed, preserving node positions', error)
    return false
  }

  for (const node of units) {
    const position = graph.node(node.id)
    if (!position) continue
    const { w, h } = getNodeSize(node)
    const boxH = h + titleTop(node) + titleBottom(node)
    node.position = {
      x: position.x - w / 2,
      y: position.y - boxH / 2 + titleTop(node),
    }
  }

  respaceRanks(units, outDegree, direction)
  alignRankStart(units, direction)
  return true
}

function layoutDirectChildren(scopeId, children, edges, direction, hierarchy) {
  const units = children.filter(isLayoutableNode)
  if (!units.length) return

  const scopeEdges = getScopeEdges(scopeId, units, edges, hierarchy)
  const marginx = scopeId == null ? 45 : 0
  const marginy = scopeId == null ? 24 : 0
  const components = connectedComponents(units, scopeEdges)
  if (components.length <= 1) {
    if (layoutGraph(units, scopeEdges, direction, marginx, marginy)) {
      wrapLongFlow(units, scopeEdges, direction)
    }
    return
  }

  const ordered = components
    .map(nodes => ({ nodes, key: componentOrderKey(nodes, direction) }))
    .sort((a, b) => a.key - b.key || String(a.nodes[0]?.id).localeCompare(String(b.nodes[0]?.id)))
  const laidOut = []
  for (const component of ordered) {
    const ids = new Set(component.nodes.map(node => node.id))
    const componentEdges = scopeEdges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
    if (layoutGraph(component.nodes, componentEdges, direction, 0, 0)) {
      wrapLongFlow(component.nodes, componentEdges, direction)
      laidOut.push(component.nodes)
    }
  }
  const gap = isHorizontalDir(direction) ? 72 : 64
  packComponents(laidOut, direction, marginx, marginy, gap)
}

function groupPadding(children, scopeEdges, direction) {
  const rects = children.map((node) => {
    const { w, h } = getNodeSize(node, nodeSizeFallback(node))
    const left = node.position?.x ?? 0
    const top = node.position?.y ?? 0
    return { id: node.id, left, top, right: left + w, bottom: top + h }
  })
  const insets = getGroupLoopInsets({ rects, edges: scopeEdges, vertical: !isHorizontalDir(direction) })
  return {
    top: Math.max(GROUP_PAD_TOP, insets.top),
    right: Math.max(GROUP_PAD_X, insets.right),
    bottom: Math.max(GROUP_PAD_BOTTOM, insets.bottom),
    left: Math.max(GROUP_PAD_X, insets.left),
  }
}

function clampOffset(centered, min, max) {
  return Math.min(Math.max(centered, min), Math.max(min, max))
}

function fitGroupToChildren(group, children, padding = {
  top: GROUP_PAD_TOP,
  right: GROUP_PAD_X,
  bottom: GROUP_PAD_BOTTOM,
  left: GROUP_PAD_X,
}) {
  const current = getNodeSize(group, {
    width: GROUP_MIN_WIDTH,
    height: GROUP_MIN_HEIGHT,
  })
  if (!children.length) {
    setNodeSize(
      group,
      Math.max(current.w, GROUP_MIN_WIDTH),
      Math.max(current.h, GROUP_MIN_HEIGHT),
    )
    return
  }

  const rects = children.map(node => {
    const { w, h } = getNodeSize(node, nodeSizeFallback(node))
    return {
      node,
      x: node.position?.x ?? 0,
      y: node.position?.y ?? 0,
      w,
      h,
    }
  })

  const minX = Math.min(...rects.map(rect => rect.x))
  const minY = Math.min(...rects.map(rect => rect.y))
  const maxX = Math.max(...rects.map(rect => rect.x + rect.w))
  const maxY = Math.max(...rects.map(rect => rect.y + rect.h))
  const contentW = maxX - minX
  const groupW = Math.max(Math.round(contentW + padding.left + padding.right), GROUP_MIN_WIDTH)
  const contentH = maxY - minY
  const groupH = Math.max(Math.round(contentH + padding.top + padding.bottom), GROUP_MIN_HEIGHT)
  const offsetX = clampOffset(Math.round((groupW - contentW) / 2), padding.left, groupW - contentW - padding.right) - minX
  const offsetY = clampOffset(Math.round((groupH - contentH) / 2), padding.top, groupH - contentH - padding.bottom) - minY
  for (const rect of rects) {
    rect.node.position = {
      x: rect.x + offsetX,
      y: rect.y + offsetY,
    }
  }
  setNodeSize(
    group,
    groupW,
    groupH,
  )
}

const DECORATION_GAP = 24

function nodeRect(node) {
  const { w, h } = getNodeSize(node, nodeSizeFallback(node))
  const x = node.position?.x ?? 0
  const y = node.position?.y ?? 0
  const top = isGroupType(node) ? y - GROUP_TITLE_OVERHANG : y
  return { x, y: top, w, h: h + (y - top) }
}

function rectDistance(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

function rectsOverlap(a, b, gap) {
  return a.x < b.x + b.w + gap
    && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap
    && a.y + a.h + gap > b.y
}

function anchorDecorations(decorations, units) {
  if (!decorations.length || !units.length) return []
  return decorations.map((node) => {
    const rect = nodeRect(node)
    let anchor = units[0]
    let best = Infinity
    for (const unit of units) {
      const distance = rectDistance(rect, nodeRect(unit))
      if (distance < best) {
        best = distance
        anchor = unit
      }
    }
    return {
      node,
      anchor,
      dx: (node.position?.x ?? 0) - (anchor.position?.x ?? 0),
      dy: (node.position?.y ?? 0) - (anchor.position?.y ?? 0),
    }
  })
}

/** 与控制台相同；额外返回让开的批注数，供摘要使用。 */
function placeDecorations(anchors, units, direction) {
  if (!anchors.length) return 0
  const horizontal = isHorizontalDir(direction)
  const axis = horizontal ? 'y' : 'x'
  const placed = []
  let moved = 0
  for (const item of anchors) {
    const { node, anchor } = item
    node.position = {
      x: (anchor.position?.x ?? 0) + item.dx,
      y: (anchor.position?.y ?? 0) + item.dy,
    }
    const obstacles = [...units, ...placed].map(nodeRect)
    const rect = nodeRect(node)
    const isFree = (value) => {
      const probe = { ...rect, [axis]: value }
      return !obstacles.some(box => rectsOverlap(probe, box, DECORATION_GAP))
    }
    const current = rect[axis]
    if (!isFree(current)) {
      const size = horizontal ? rect.h : rect.w
      const candidates = obstacles.flatMap(box => (horizontal
        ? [box.y - DECORATION_GAP - size, box.y + box.h + DECORATION_GAP]
        : [box.x - DECORATION_GAP - size, box.x + box.w + DECORATION_GAP]))
      const best = candidates
        .filter(isFree)
        .sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0]
      if (best != null) {
        node.position = { ...node.position, [axis]: best }
        moved += 1
      }
    }
    placed.push(node)
  }
  return moved
}

function doApplyLayout(
  nodes,
  edges,
  direction = 'TB',
  sourcePosition = 'bottom',
  targetPosition = 'top',
) {
  const stats = { groups: 0, decorations: 0 }
  if (!Array.isArray(nodes)) return stats
  const list = nodes
  const edgeList = Array.isArray(edges) ? edges : []
  const hierarchy = createHierarchy(list)
  const visited = new Set()

  function layoutScope(scopeId) {
    if (scopeId && visited.has(scopeId)) return
    if (scopeId) visited.add(scopeId)
    const children = hierarchy.childrenByParent.get(scopeId || null) || []
    for (const child of children) {
      if (child.type === 'group') layoutScope(child.id)
    }
    const layoutable = children.filter(isLayoutableNode)
    const decorations = children.filter(node => !isLayoutableNode(node))
    const anchors = anchorDecorations(decorations, layoutable)
    layoutDirectChildren(scopeId, children, edgeList, direction, hierarchy)
    stats.decorations += placeDecorations(anchors, layoutable, direction)
    if (scopeId) {
      const group = hierarchy.byId.get(scopeId)
      if (group) {
        const scopeEdges = getScopeEdges(scopeId, layoutable, edgeList, hierarchy)
        fitGroupToChildren(group, children, groupPadding(layoutable, scopeEdges, direction))
        stats.groups += 1
      }
    }
  }

  layoutScope(null)
  for (const node of list) {
    setHandlePositions(node, direction, sourcePosition, targetPosition)
  }
  return stats
}

// ---------------------------------------------------------------------------
// 命令行
// ---------------------------------------------------------------------------

const MIN_X = 40
const MIN_Y = 24

function fail(message, code = 3) {
  process.stderr.write(`layout: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const args = { file: null, out: null, direction: null, check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') args.check = true
    else if (arg === '-o' || arg === '--out') args.out = argv[++i]
    else if (arg === '--direction' || arg === '-d') args.direction = String(argv[++i] || '').toUpperCase()
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write('usage: node scripts/layout.mjs flow.json [--direction TB|LR] [-o out.json] [--check]\n')
      process.exit(0)
    } else if (!args.file) args.file = arg
    else fail(`多余的参数: ${arg}`)
  }
  if (!args.file) fail('缺少 flow.json 路径。用法: node scripts/layout.mjs flow.json [--direction TB|LR] [-o out.json] [--check]')
  if (args.direction && !['TB', 'LR'].includes(args.direction)) fail('--direction 只能是 TB 或 LR')
  return args
}

/** 排版前先拦下会让控制台画错的结构。 */
function checkGraph(nodes, edges) {
  const problems = []
  const byId = new Map()
  for (const node of nodes) {
    if (!node?.id) problems.push('有节点缺少 id')
    else if (byId.has(node.id)) problems.push(`节点 id 重复: ${node.id}`)
    else byId.set(node.id, node)
  }
  for (const node of nodes) {
    if (!node?.parentNode) continue
    const parent = byId.get(node.parentNode)
    if (!parent) problems.push(`${node.id} 的 parentNode 指向不存在的节点 ${node.parentNode}`)
    else if (parent.type !== 'group') problems.push(`${node.id} 的 parentNode ${node.parentNode} 不是分组框（type 应为 "group"）`)
  }
  for (const edge of edges) {
    for (const end of ['source', 'target']) {
      const node = byId.get(edge?.[end])
      if (!node) problems.push(`边 ${edge?.id ?? '?'} 的 ${end} 指向不存在的节点 ${edge?.[end]}`)
      else if (node.type === 'group') problems.push(`边 ${edge.id ?? '?'} 连到了分组框 ${node.id}，应连组内业务节点`)
      else if (DECORATION_TYPES.has(node.type)) problems.push(`边 ${edge.id ?? '?'} 连到了批注 ${node.id}，批注不连线`)
    }
  }
  return problems
}

function snapshot(node) {
  return JSON.stringify([
    node.position?.x, node.position?.y,
    node.sourcePosition, node.targetPosition,
    node.type === 'group' ? [node.style?.width, node.style?.height] : null,
  ])
}

function shiftTopLevelIntoView(nodes) {
  const ids = new Set(nodes.map(node => node.id))
  const topLevel = nodes.filter(node => !(node.parentNode && ids.has(node.parentNode)))
  if (!topLevel.length) return
  const minX = Math.min(...topLevel.map(node => node.position?.x ?? 0))
  const minY = Math.min(...topLevel.map(node => node.position?.y ?? 0))
  const dx = minX < MIN_X ? MIN_X - minX : 0
  const dy = minY < MIN_Y ? MIN_Y - minY : 0
  shiftNodes(topLevel, dx, dy)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  let text
  try {
    text = readFileSync(args.file, 'utf8')
  } catch (error) {
    fail(`读不到 ${args.file}: ${error.message}`)
  }
  let flow
  try {
    flow = JSON.parse(text)
  } catch (error) {
    fail(`${args.file} 不是合法 JSON: ${error.message}`)
  }
  if (!flow || !Array.isArray(flow.nodes)) fail('顶层缺少 nodes 数组（要传画布 JSON，而不是整个草稿响应）')
  const edges = Array.isArray(flow.edges) ? flow.edges : []

  const problems = checkGraph(flow.nodes, edges)
  if (problems.length) fail(`图结构有问题，先修再排版:\n  - ${problems.join('\n  - ')}`)

  const direction = args.direction || (['TB', 'LR'].includes(flow.direction) ? flow.direction : 'TB')
  const before = new Map(flow.nodes.map(node => [node.id, snapshot(node)]))
  const sizeKeys = new Map(flow.nodes.map(node => [node.id, {
    width: Object.hasOwn(node, 'width'),
    height: Object.hasOwn(node, 'height'),
    dimensions: Object.hasOwn(node, 'dimensions'),
  }]))
  for (const node of flow.nodes) {
    node.position = { x: node.position?.x ?? 0, y: node.position?.y ?? 0 }
  }

  const sourcePosition = direction === 'LR' ? 'right' : 'bottom'
  const targetPosition = direction === 'LR' ? 'left' : 'top'
  const stats = doApplyLayout(flow.nodes, edges, direction, sourcePosition, targetPosition)
  shiftTopLevelIntoView(flow.nodes)

  // 控制台保存时只留 position 与分组 style；临时宽高不写回，否则会把卡片锁死在兜底尺寸
  for (const node of flow.nodes) {
    const had = sizeKeys.get(node.id)
    if (!had.dimensions) delete node.dimensions
    if (!had.width) delete node.width
    if (!had.height) delete node.height
  }

  const directionChanged = flow.direction !== direction
  flow.direction = direction
  if (!flow.errors || typeof flow.errors !== 'object') flow.errors = {}
  const moved = flow.nodes.filter(node => before.get(node.id) !== snapshot(node)).length
  const summary = `layout ${direction}: ${flow.nodes.length} 个节点，${moved} 个有变化，`
    + `${stats.groups} 个分组重算尺寸，${stats.decorations} 张批注让开`

  if (args.check) {
    if (moved || directionChanged) {
      process.stdout.write(`${summary}。坐标与自动排版不一致，去掉 --check 重新运行。\n`)
      process.exit(1)
    }
    process.stdout.write(`${summary}。已是自动排版结果。\n`)
    return
  }

  writeFileSync(args.out || args.file, `${JSON.stringify(flow, null, 2)}\n`)
  process.stdout.write(`${summary}。已写入 ${args.out || args.file}\n`)
}

main()
