// ============================================
// Дашборд продаж квартир в ЖК
// Основная логика: Vue.js + D3.js
// ============================================

// --- Вспомогательные функции ---
function formatMoney(value) {
    if (!value) return '0 ₽';
    return value.toLocaleString('ru-RU') + ' ₽';
}

function formatNumber(value) {
    return value.toLocaleString('ru-RU');
}

// Парсинг даты вида "7/29/2022"
function parseDate(str) {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    return new Date(+parts[2], +parts[0] - 1, +parts[1]);
}

function monthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июнь', 'Июль', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    return months[m - 1] + ' ' + y;
}

// Цвета для менеджеров
const MANAGER_COLORS = {
    'Иван': '#4e79a7',
    'Саша': '#f28e2b',
    'Лиана': '#e15759',
    'Филипп': '#76b7b2',
    'Миша': '#59a14f'
};
const DEFAULT_MANAGER_COLOR = '#9c755f';

// Палитра цветов для месяцев продаж
const MONTH_PALETTE = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948',
    '#b07aa1', '#1abc9c', '#9c755f', '#bab0ac', '#86bcb6', '#d37295',
    '#a0cbe8', '#ffbe7d', '#16a085', '#8cd17d', '#499894', '#f1ce63'
];

// Цвета для видов
const VIEW_COLORS = {
    'на дорогу': '#e15759',
    'на реку': '#4e79a7',
    'окна в окна': '#f28e2b',
    'на ЖК': '#59a14f',
    'на лес': '#76b7b2',
    'во двор': '#edc948'
};
const DEFAULT_VIEW_COLOR = '#b7b7b7';

// Цвета для комнат
const ROOM_COLORS = {
    1: '#aec7e8',
    2: '#98df8a',
    3: '#ff9896'
};

// --- Vue приложение ---
const { createApp } = Vue;

const app = createApp({
    data() {
        return {
            apartments: APARTMENT_DATA,
            colorMode: 'status',
            showMode: 'all',
            searchQuery: '',
            filterCorp: '',
            filterStatus: '',
            filterMonth: 'all'
        };
    },
    computed: {
        corps() {
            return [...new Set(this.apartments.map(a => a.corp))].sort();
        },
        // Доступные месяцы (по датам сделок проданных квартир)
        months() {
            const set = new Set();
            this.apartments.forEach(a => {
                if (a.sold && a.dateDeal) {
                    const d = parseDate(a.dateDeal);
                    if (d) set.add(monthKey(d));
                }
            });
            return [...set].sort().map(k => ({ key: k, label: monthLabel(k) }));
        },
        // Квартиры с учётом фильтра по месяцу:
        // если выбран месяц — «проданными» считаются только проданные в этом месяце,
        // непроданные всегда остаются (чтобы видеть, что в этот месяц не продано)
        monthFilteredApartments() {
            if (!this.filterMonth || this.filterMonth === 'all') return this.apartments;
            return this.apartments.map(a => {
                if (!a.sold) return a;
                const d = parseDate(a.dateDeal);
                const inMonth = d && monthKey(d) === this.filterMonth;
                // otherMonth: квартира продана, но в другом месяце (не в выбранном)
                return { ...a, sold: inMonth, otherMonth: !inMonth };
            });
        },
        stats() {
            const list = this.monthFilteredApartments;
            const sold = list.filter(a => a.sold);
            const revenue = sold.reduce((s, a) => s + (a.priceSale || 0), 0);
            const discount = sold.reduce((s, a) => s + (a.discount || 0), 0);
            return {
                total: list.length,
                sold: sold.length,
                unsold: list.length - sold.length,
                revenue: revenue,
                discount: discount
            };
        },
        filteredApartments() {
            let list = this.monthFilteredApartments;
            if (this.searchQuery) {
                const q = this.searchQuery.toLowerCase();
                list = list.filter(a =>
                    a.apt.toLowerCase().includes(q) ||
                    (a.manager || '').toLowerCase().includes(q) ||
                    (a.plan || '').toLowerCase().includes(q)
                );
            }
            if (this.filterCorp) {
                list = list.filter(a => a.corp === this.filterCorp);
            }
            if (this.filterStatus === 'sold') {
                list = list.filter(a => a.sold);
            } else if (this.filterStatus === 'unsold') {
                list = list.filter(a => !a.sold);
            }
            return list;
        }
    },
    methods: {
        formatMoney,
        formatNumber,
        // Перерисовать все графики (при смене фильтра по месяцу)
        renderAll() {
            this.renderMainChart();
        },
        // ============================================
        // ОСНОВНОЙ ГРАФИК: схема дома
        // ============================================
        renderMainChart() {
            const container = document.getElementById('mainChart');
            container.innerHTML = '';
            const width = 1420;
            const height = 660;
            const margin = { top: 70, right: 5, bottom: 130, left: 70 };

            const svg = d3.select(container)
                .append('svg')
                .attr('width', width)
                .attr('height', height)
                .style('min-width', '900px');

            // Определяем структуру корпусов
            // ГП1, ГП2, ГП3: секция А, 17 этажей, 7 квартир на этаже (кроме 1-го)
            // ГП4: секции А, Б, В, 10 этажей, 4 квартиры на этаже
            const corpStructures = this.buildCorpStructures();

            // Определяем максимальное число этажей для масштаба
            const maxFloors = 17;
            const floorH = (height - margin.top - margin.bottom) / maxFloors;

            // Ось Y: этажи (1 внизу, 17 наверху)
            const yScale = d3.scaleLinear()
                .domain([1, maxFloors])
                .range([height - margin.bottom, margin.top]);

            // Ось Y
            // Позиция оси Y (левее начала домов, чтобы был отступ между шкалой и первым домом)
            const axisX = margin.left - 30;
            const yAxis = d3.axisLeft(yScale)
                .tickValues(d3.range(1, maxFloors + 1))
                .tickFormat(d => d);
            svg.append('g')
                .attr('transform', `translate(${axisX}, 0)`)
                .call(yAxis)
                .selectAll('text')
                .style('font-size', '11px');
            svg.append('text')
                .attr('transform', 'rotate(-90)')
                .attr('x', -(height / 2))
                .attr('y', 15)
                .attr('text-anchor', 'middle')
                .style('font-size', '13px')
                .style('fill', '#555')
                .text('Этаж');

            // Распределяем корпуса по оси X
            // Клетки разной ширины (по комнатам) упаковываются вплотную друг к другу
            const corpKeys = Object.keys(corpStructures);
            const plotWidth = width - margin.left - margin.right;
            // Зазор между домами (покрупнее)
            const corpGap = 34;
            // Зазор между корпусами (секциями) внутри одного дома (поменьше)
            const secGap = 16;
            // Общее число внутренних зазоров секций по всем домам
            const totalSecGaps = corpKeys.reduce((sum, k) => sum + (corpStructures[k].sections.length - 1), 0);
            // Суммарная упакованная ширина всех секций (в единицах unitW)
            const totalPackedUnits = corpKeys.reduce((sum, k) =>
                sum + corpStructures[k].sections.reduce((s, sec) => s + sec.packedUnits, 0), 0);
            const totalGap = corpGap * (corpKeys.length - 1) + secGap * totalSecGaps;
            const unitW = (plotWidth - totalGap) / totalPackedUnits;

            let xOffset = margin.left;
            const corpXPositions = {};

            corpKeys.forEach(corp => {
                const struct = corpStructures[corp];
                const corpWidth = struct.sections.reduce((s, sec) => s + sec.packedUnits * unitW, 0)
                    + (struct.sections.length - 1) * secGap;
                corpXPositions[corp] = { x: xOffset, width: corpWidth, struct: struct };
                xOffset += corpWidth + corpGap;
            });

            // Рисуем корпуса
            corpKeys.forEach(corp => {
                const pos = corpXPositions[corp];
                const struct = pos.struct;

                // Рисуем секции внутри корпуса
                let secOffsetX = pos.x;
                struct.sections.forEach(sec => {
                    const secX = secOffsetX;

                    // Упакованные x-позиции колонок внутри секции (вплотную, без зазоров)
                    const colX = [];
                    let cx = 0;
                    for (let ci = 0; ci < sec.unitsPerFloor; ci++) {
                        colX.push(cx);
                        cx += this.widthFactor(sec.colRooms[ci] || 2) * unitW;
                    }
                    const secWidth = cx;

                    // Рисуем квартиры
                    sec.apartments.forEach(apt => {
                        // Позиция квартиры в ряду
                        const posInRow = apt.rowIndex;
                        const cellW = this.getCellWidth(apt.rooms, sec.unitsPerFloor, unitW);
                        const cellX = secX + colX[posInRow];
                        const cellY = yScale(apt.floor) - floorH / 2 + 1;

                        // Пропускаем если не в режиме показа
                        if (this.showMode === 'sold' && !apt.sold) return;
                        if (this.showMode === 'unsold' && apt.sold) return;

                        const color = this.getCellColor(apt);
                        const cellH = floorH - 2;

                        svg.append('rect')
                            .attr('x', cellX)
                            .attr('y', cellY)
                            .attr('width', cellW)
                            .attr('height', cellH)
                            .attr('rx', 1)
                            .attr('fill', color)
                            .attr('stroke', 'none')
                            .style('cursor', 'pointer')
                            .on('mouseover', (event) => this.showTooltip(event, apt))
                            .on('mousemove', (event) => this.moveTooltip(event))
                            .on('mouseout', () => this.hideTooltip());

                        // На проданных квартирах — первая буква имени менеджера
                        if (apt.sold && apt.manager) {
                            const initial = apt.manager.trim().charAt(0).toUpperCase();
                            if (initial) {
                                svg.append('text')
                                    .attr('x', cellX + cellW / 2)
                                    .attr('y', cellY + cellH / 2)
                                    .attr('text-anchor', 'middle')
                                    .attr('dominant-baseline', 'central')
                                    .style('font-size', '10px')
                                    .style('font-weight', 'bold')
                                    .style('fill', '#fff')
                                    .style('pointer-events', 'none')
                                    .text(initial);
                            }
                        }

                    });

                    // Тонкие линии-разделители между квартирами (вертикальные)
                    for (let ci = 1; ci < sec.unitsPerFloor; ci++) {
                        const lineX = secX + colX[ci];
                        svg.append('line')
                            .attr('x1', lineX)
                            .attr('y1', yScale(1) - floorH / 2 + 1)
                            .attr('x2', lineX)
                            .attr('y2', yScale(sec.apartments.length ? Math.max(...sec.apartments.map(a => a.floor)) : 1) + floorH / 2 - 1)
                            .attr('stroke', 'rgba(255,255,255,0.7)')
                            .attr('stroke-width', 1);
                    }

                    secOffsetX += secWidth + secGap;
                });

                // Единая серая плитка для пустых мест на 1-м этаже (магазины)
                // Собираем занятые x-диапазоны на 1-м этаже по всем секциям корпуса
                const occupiedRanges = [];
                let secOff = pos.x;
                struct.sections.forEach(sec => {
                    // Упакованные x-позиции колонок секции
                    const colX = [];
                    let cx = 0;
                    for (let ci = 0; ci < sec.unitsPerFloor; ci++) {
                        colX.push(cx);
                        cx += this.widthFactor(sec.colRooms[ci] || 2) * unitW;
                    }
                    const secWidth = cx;
                    // Занятые колонки на 1-м этаже
                    const occupiedCols = new Set(
                        sec.apartments.filter(a => a.floor === 1).map(a => a.rowIndex)
                    );
                    for (let ci = 0; ci < sec.unitsPerFloor; ci++) {
                        if (occupiedCols.has(ci)) {
                            occupiedRanges.push([secOff + colX[ci], secOff + colX[ci] + this.widthFactor(sec.colRooms[ci] || 2) * unitW]);
                        }
                    }
                    secOff += secWidth + secGap;
                });

                // Сортируем занятые диапазоны по x
                occupiedRanges.sort((a, b) => a[0] - b[0]);

                // Находим пустые промежутки между занятыми диапазонами и по краям
                const tileY = yScale(1) - floorH / 2 + 1;
                const tileH = floorH - 2;
                const corpStart = pos.x;
                const corpEnd = pos.x + pos.width;
                let cursor = corpStart;
                occupiedRanges.forEach(([s, e]) => {
                    if (s > cursor) {
                        // Пустой промежуток от cursor до s
                        const tileX = cursor + 1;
                        const tileW = (s - cursor) - 2;
                        if (tileW > 0) {
                            svg.append('rect')
                                .attr('x', tileX)
                                .attr('y', tileY)
                                .attr('width', tileW)
                                .attr('height', tileH)
                                .attr('rx', 2)
                                .attr('fill', '#b8b8b8')
                                .attr('stroke', '#fff')
                                .attr('stroke-width', 1)
                                .style('cursor', 'default')
                                .on('mouseover', (event) => this.showChartTip(event, 'Нежилое помещение (магазины)'))
                                .on('mousemove', (event) => this.moveChartTip(event))
                                .on('mouseout', () => this.hideChartTip());
                        }
                    }
                    cursor = Math.max(cursor, e);
                });
                // Пустой промежуток в конце корпуса
                if (cursor < corpEnd) {
                    const tileX = cursor + 1;
                    const tileW = (corpEnd - cursor) - 2;
                    if (tileW > 0) {
                        svg.append('rect')
                            .attr('x', tileX)
                            .attr('y', tileY)
                            .attr('width', tileW)
                            .attr('height', tileH)
                            .attr('rx', 2)
                            .attr('fill', '#b8b8b8')
                            .attr('stroke', '#fff')
                            .attr('stroke-width', 1)
                            .style('cursor', 'default')
                            .on('mouseover', (event) => this.showChartTip(event, 'Нежилое помещение (магазины)'))
                            .on('mousemove', (event) => this.moveChartTip(event))
                            .on('mouseout', () => this.hideChartTip());
                    }
                }
            });

            // Ось X: подписи домов и секций внизу
            corpKeys.forEach(corp => {
                const pos = corpXPositions[corp];
                const struct = pos.struct;

                // Максимальный этаж в этом доме (у ГП4 — 10, у остальных — 17)
                let corpMaxFloor = 0;
                struct.sections.forEach(s => s.apartments.forEach(a => {
                    if (a.floor > corpMaxFloor) corpMaxFloor = a.floor;
                }));

                // Подписи секций внутри дома
                let secOff = pos.x;
                struct.sections.forEach(sec => {
                    // Упакованные x-позиции колонок секции
                    const colX = [];
                    let cx = 0;
                    for (let ci = 0; ci < sec.unitsPerFloor; ci++) {
                        colX.push(cx);
                        cx += this.widthFactor(sec.colRooms[ci] || 2) * unitW;
                    }
                    const secWidth = cx;
                    const secX = secOff;

                    // Подписи вида для каждой колонки (над буквой корпуса)
                    const VIEW_SHORT = {
                        'на дорогу': 'дорога',
                        'на реку': 'река',
                        'окна в окна': 'окна',
                        'на ЖК': 'ЖК',
                        'на лес': 'лес',
                        'во двор': 'двор'
                    };
                    const colInfo = {};
                    sec.apartments.forEach(a => {
                        if (!colInfo[a.rowIndex]) colInfo[a.rowIndex] = { rooms: a.rooms, view: a.view, plan: a.plan };
                    });
                    for (let ci = 0; ci < sec.unitsPerFloor; ci++) {
                        const info = colInfo[ci];
                        if (!info) continue;
                        const shortView = VIEW_SHORT[info.view] || info.view;
                        const label = shortView;
                        const colW = this.widthFactor(sec.colRooms[ci] || 2) * unitW;
                        const colXPos = secX + colX[ci] + colW / 2;
                        // Подпись планировки сверху (над верхним этажом)
                        if (info.plan) {
                            const planFont = Math.min(9, colW / (info.plan.length * 0.62));
                            // Подпись на одинаковом расстоянии (~11px) над верхним этажом каждого дома
                            const labelY = yScale(corpMaxFloor) - floorH / 2 + 1 - 11;
                            svg.append('text')
                                .attr('x', colXPos)
                                .attr('y', labelY)
                                .attr('text-anchor', 'middle')
                                .style('font-size', planFont + 'px')
                                .style('font-weight', 'bold')
                                .style('fill', '#666')
                                .text(info.plan);
                        }
                        svg.append('text')
                            .attr('x', colXPos)
                            .attr('y', height - 100)
                            .attr('text-anchor', 'middle')
                            .style('font-size', '9px')
                            .style('fill', '#999')
                            .text(label);
                    }

                    // Подпись секции (буква корпуса) — ниже подписей колонок
                    svg.append('text')
                        .attr('x', secX + secWidth / 2)
                        .attr('y', height - 83)
                        .attr('text-anchor', 'middle')
                        .style('font-size', '11px')
                        .style('fill', '#888')
                        .text(sec.name);

                    secOff += secWidth + secGap;
                });

                // Название дома по центру внизу (ниже букв корпуса)
                svg.append('text')
                    .attr('x', pos.x + pos.width / 2)
                    .attr('y', height - 60)
                    .attr('text-anchor', 'middle')
                    .style('font-size', '15px')
                    .style('font-weight', 'bold')
                    .style('fill', '#1a2980')
                    .text(corp);
            });

            this.renderLegend();
            this.renderManagerSideChart();
        },

        // Боковой график по менеджерам (показывается в режимах «Продано/не продано», «По скорости продаж», «По цене продажи», «По менеджеру» и «Скидка»)
        renderManagerSideChart() {
            const container = document.getElementById('managerSideChart');
            if (!container) return;
            container.innerHTML = '';

            // Показываем только в режимах «Продано/не продано», «По скорости продаж», «По цене продажи», «По менеджеру» и «Скидка»
            if (this.colorMode !== 'status' && this.colorMode !== 'speed' && this.colorMode !== 'price' && this.colorMode !== 'manager' && this.colorMode !== 'discount') return;

            const isDiscount = this.colorMode === 'discount';
            const isSpeed = this.colorMode === 'speed';
            const isPrice = this.colorMode === 'price';
            const all = this.monthFilteredApartments;
            const sold = all.filter(a => a.sold && a.manager);
            const managers = [...new Set(sold.map(a => a.manager))];

            const data = managers.map(m => {
                const mSold = sold.filter(a => a.manager === m);
                const avgDays = mSold.length ? Math.round(mSold.reduce((s, a) => s + (a.days || 0), 0) / mSold.length) : 0;
                return {
                    name: m,
                    count: mSold.length,
                    discount: mSold.reduce((s, a) => s + (a.discount || 0), 0),
                    revenue: mSold.reduce((s, a) => s + (a.priceSale || 0), 0),
                    avgDays: avgDays,
                    color: MANAGER_COLORS[m] || DEFAULT_MANAGER_COLOR
                };
            });

            // Сортируем по выбранной метрике
            const metric = isDiscount ? 'discount' : (isSpeed ? 'avgDays' : (isPrice ? 'revenue' : 'count'));
            if (isSpeed) {
                data.sort((a, b) => a[metric] - b[metric]); // быстрее — первыми
            } else {
                data.sort((a, b) => b[metric] - a[metric]);
            }

            if (data.length === 0) {
                container.innerHTML = '<p style="color:#999;text-align:center;padding:20px">Нет данных</p>';
                return;
            }

            const width = 330, height = 560;
            const margin = { top: 30, right: 20, bottom: 60, left: 72 };

            const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

            const x = d3.scaleBand().domain(data.map(d => d.name)).range([margin.left, width - margin.right]).padding(0.3);
            const y = d3.scaleLinear().domain([0, d3.max(data, d => d[metric])]).nice().range([height - margin.bottom, margin.top]);

            svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d => (isDiscount || isPrice) ? (d / 1000).toFixed(0) + 'К' : d));
            svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x)).selectAll('text').style('font-size', '11px');

            svg.append('text')
                .attr('x', width / 2)
                .attr('y', 16)
                .attr('text-anchor', 'middle')
                .style('font-size', '13px')
                .style('font-weight', 'bold')
                .style('fill', '#1a2980')
                .text(isDiscount ? 'Скидки по менеджерам' : (isSpeed ? 'Скорость продаж по менеджерам' : (isPrice ? 'Выручка по менеджерам' : 'Продажи по менеджерам')));

            svg.append('text')
                .attr('transform', 'rotate(-90)')
                .attr('x', -(height / 2))
                .attr('y', 10)
                .attr('text-anchor', 'middle')
                .style('font-size', '11px')
                .style('fill', '#555')
                .text(isDiscount ? 'Скидки, руб.' : (isSpeed ? 'Ср. дней продажи' : (isPrice ? 'Сумма продаж, руб.' : 'Кол-во продаж')));

            // Бары
            svg.selectAll('.bar')
                .data(data)
                .enter().append('rect')
                .attr('x', d => x(d.name))
                .attr('y', d => y(d[metric]))
                .attr('width', x.bandwidth())
                .attr('height', d => height - margin.bottom - y(d[metric]))
                .attr('fill', d => d.color)
                .attr('rx', 4)
                .on('mouseover', (event, d) => {
                    let tip;
                    if (isDiscount) {
                        tip = `<b>${d.name}</b><br>Скидки: ${this.formatMoney(d.discount)}<br>Продаж: ${d.count}`;
                    } else if (isSpeed) {
                        tip = `<b>${d.name}</b><br>Ср. дней продажи: ${d.avgDays}<br>Продаж: ${d.count}`;
                    } else if (isPrice) {
                        tip = `<b>${d.name}</b><br>Сумма продаж: ${this.formatMoney(d.revenue)}<br>Продаж: ${d.count}`;
                    } else {
                        tip = `<b>${d.name}</b><br>Продаж: ${d.count}`;
                    }
                    this.showChartTip(event, tip);
                })
                .on('mousemove', (event) => {
                    this.moveChartTip(event);
                })
                .on('mouseout', () => {
                    this.hideChartTip();
                });

            // Подписи значений
            svg.selectAll('.label')
                .data(data)
                .enter().append('text')
                .attr('x', d => x(d.name) + x.bandwidth() / 2)
                .attr('y', d => y(d[metric]) - 5)
                .attr('text-anchor', 'middle')
                .style('font-size', '11px')
                .style('font-weight', 'bold')
                .text(d => (isDiscount || isPrice) ? (d[metric] / 1000).toFixed(0) + 'К' : d[metric]);

            // Фактоид сверху: сколько квартир продано из скольки
            if (this.colorMode === 'status') {
                const total = all.length;
                const soldCount = all.filter(a => a.sold).length;
                const pct = total ? Math.round(soldCount / total * 100) : 0;
                const factoid = document.createElement('div');
                factoid.style.cssText = 'text-align:center;padding:10px 14px;border-bottom:1px solid #e3e6ea;margin-bottom:8px;';
                factoid.innerHTML = `<div style="font-size:22px;font-weight:bold;color:#1a2980">${soldCount} <span style="color:#999;font-weight:normal;font-size:14px">из ${total}</span></div>
                    <div style="font-size:12px;color:#666">квартир продано (${pct}%)</div>`;
                container.insertBefore(factoid, container.firstChild);
            }
        },

        // Построение структуры корпусов из данных
        buildCorpStructures() {
            const structures = {};
            const list = this.monthFilteredApartments;
            const corps = [...new Set(list.map(a => a.corp))].sort();

            corps.forEach(corp => {
                const corpApts = list.filter(a => a.corp === corp);
                const secs = [...new Set(corpApts.map(a => a.sec))].sort();

                // Определяем квартиры по секциям
                const sections = secs.map(sec => {
                    const secApts = corpApts.filter(a => a.sec === sec);
                    // Сортируем по этажу и номеру
                    secApts.sort((a, b) => a.floor - b.floor || a.num - b.num);

                    // Определяем rowIndex: позицию квартиры на этаже
                    // Группируем по этажам
                    const floorGroups = {};
                    secApts.forEach(a => {
                        if (!floorGroups[a.floor]) floorGroups[a.floor] = [];
                        floorGroups[a.floor].push(a);
                    });

                    // Для каждой квартиры определяем её индекс в ряду этажа
                    Object.keys(floorGroups).forEach(f => {
                        floorGroups[f].sort((a, b) => a.num - b.num);
                        floorGroups[f].forEach((a, i) => {
                            a.rowIndex = i;
                        });
                    });

                    // unitsPerFloor для секции
                    const unitsPerFloor = Math.max(...Object.values(floorGroups).map(g => g.length));

                    // Комнаты по колонкам (rowIndex) — одинаковы на всех этажах
                    const colRooms = {};
                    secApts.forEach(a => {
                        if (colRooms[a.rowIndex] === undefined) colRooms[a.rowIndex] = a.rooms;
                    });

                    // Суммарная «упакованная» ширина секции (в единицах unitW)
                    let packedUnits = 0;
                    for (let ci = 0; ci < unitsPerFloor; ci++) {
                        packedUnits += this.widthFactor(colRooms[ci] || 2);
                    }

                    return {
                        name: sec,
                        apartments: secApts,
                        unitsPerFloor: unitsPerFloor,
                        colRooms: colRooms,
                        packedUnits: packedUnits
                    };
                });

                // Вычисляем offset (позицию в ряду) для каждой секции
                let runningOffset = 0;
                sections.forEach((s, idx) => {
                    s.offset = runningOffset;
                    s.secIndex = idx;
                    runningOffset += s.unitsPerFloor;
                });

                // Общее число квартир на этаже для корпуса
                const unitsPerFloor = sections.reduce((sum, s) => sum + s.unitsPerFloor, 0);

                structures[corp] = {
                    sections: sections,
                    unitsPerFloor: unitsPerFloor
                };
            });

            return structures;
        },

        // Ширина клетки в зависимости от числа комнат
        // Относительная ширина клетки в зависимости от числа комнат (в единицах unitW)
        widthFactor(rooms) {
            // 1 комн - маленькая, 2 - средняя, 3 - большая
            if (rooms === 1) return 0.54;
            if (rooms === 2) return 0.81;
            return 1.08; // 3 комнаты
        },

        getCellWidth(rooms, unitsPerFloor, unitW) {
            return this.widthFactor(rooms) * unitW;
        },

        // Цвет месяца продажи (по индексу в палитре)
        monthColor(key) {
            const idx = this.months.findIndex(m => m.key === key);
            if (idx < 0) return '#9c755f';
            return MONTH_PALETTE[idx % MONTH_PALETTE.length];
        },

        // Цвет по скорости продажи (меньше дней — быстрее, зелёный; больше — красный)
        speedColor(days) {
            const d = Math.min(Math.max(days || 0, 0), 60);
            const t = d / 60; // 0..1
            // от зелёного (быстро) через жёлтый к красному (медленно)
            const r = Math.round(46 + (231 - 46) * t);
            const g = Math.round(204 - (204 - 76) * t);
            const b = Math.round(113 - (113 - 60) * t);
            return `rgb(${r},${g},${b})`;
        },

        // Цвет по цене продажи (дешевле — светлее, дороже — темнее/насыщеннее)
        priceColor(price) {
            const p = Math.min(Math.max(price || 0, 0), 15000000);
            const t = p / 15000000; // 0..1
            // от светло-голубого (дёшево) к тёмно-фиолетовому (дорого)
            const r = Math.round(174 + (74 - 174) * t);
            const g = Math.round(214 + (52 - 214) * t);
            const b = Math.round(241 + (110 - 241) * t);
            return `rgb(${r},${g},${b})`;
        },

        // Цвет клетки в зависимости от режима
        getCellColor(apt) {
            // Квартиры, проданные в другом месяце (при выбранном конкретном месяце) — серые
            if (apt.otherMonth) return '#bdbdbd';
            switch (this.colorMode) {
                case 'status':
                    return apt.sold ? '#2ecc71' : '#e74c3c';
                case 'speed':
                    if (!apt.sold) return '#e0e0e0';
                    return this.speedColor(apt.days);
                case 'price':
                    if (!apt.sold) return '#e0e0e0';
                    return this.priceColor(apt.priceSale);
                case 'month':
                    if (!apt.sold) return '#e0e0e0';
                    if (!apt.dateDeal) return '#9c755f';
                    const d = parseDate(apt.dateDeal);
                    return d ? this.monthColor(monthKey(d)) : '#9c755f';
                case 'manager':
                    if (!apt.sold) return '#e0e0e0';
                    return MANAGER_COLORS[apt.manager] || DEFAULT_MANAGER_COLOR;
                case 'rooms':
                    return ROOM_COLORS[apt.rooms] || '#ccc';
                case 'view':
                    return VIEW_COLORS[apt.view] || DEFAULT_VIEW_COLOR;
                case 'discount':
                    if (!apt.sold) return '#e0e0e0';
                    if (apt.discount === 0) return '#2ecc71';
                    if (apt.discount < 150000) return '#f1c40f';
                    return '#e74c3c';
                default:
                    return apt.sold ? '#2ecc71' : '#e74c3c';
            }
        },

        // Легенда
        renderLegend() {
            const legend = document.getElementById('mainLegend');
            legend.innerHTML = '';
            let items = [];

            if (this.colorMode === 'status') {
                items = [
                    { color: '#2ecc71', label: 'Продано' },
                    { color: '#e74c3c', label: 'Не продано' }
                ];
            } else if (this.colorMode === 'speed') {
                items = [
                    { color: '#e0e0e0', label: 'Не продано' },
                    { color: this.speedColor(0), label: 'Быстро (≤ 15 дн.)' },
                    { color: this.speedColor(30), label: 'Средне (≈ 30 дн.)' },
                    { color: this.speedColor(60), label: 'Долго (≥ 60 дн.)' }
                ];
            } else if (this.colorMode === 'price') {
                items = [
                    { color: '#e0e0e0', label: 'Не продано' },
                    { color: this.priceColor(3000000), label: '≈ 3 млн' },
                    { color: this.priceColor(8000000), label: '≈ 8 млн' },
                    { color: this.priceColor(15000000), label: '≥ 15 млн' }
                ];
            } else if (this.colorMode === 'month') {
                items = [
                    { color: '#e0e0e0', label: 'Не продано' },
                    ...this.months.map(m => ({ color: this.monthColor(m.key), label: m.label }))
                ];
            } else if (this.colorMode === 'manager') {
                items = [
                    { color: '#e0e0e0', label: 'Не продано' },
                    ...Object.entries(MANAGER_COLORS).map(([name, color]) => ({ color, label: name }))
                ];
            } else if (this.colorMode === 'rooms') {
                items = [
                    { color: ROOM_COLORS[1], label: '1 комн.' },
                    { color: ROOM_COLORS[2], label: '2 комн.' },
                    { color: ROOM_COLORS[3], label: '3 комн.' }
                ];
            } else if (this.colorMode === 'view') {
                items = Object.entries(VIEW_COLORS).map(([name, color]) => ({ color, label: name }));
            } else if (this.colorMode === 'discount') {
                items = [
                    { color: '#e0e0e0', label: 'Не продано' },
                    { color: '#2ecc71', label: 'Без скидки' },
                    { color: '#f1c40f', label: 'Скидка < 150 тыс.' },
                    { color: '#e74c3c', label: 'Скидка ≥ 150 тыс.' }
                ];
            }

            // Если выбран конкретный месяц — показываем в легенде серые квартиры,
            // проданные в другом месяце
            if (this.filterMonth && this.filterMonth !== 'all') {
                items.push({ color: '#bdbdbd', label: 'Продано в др. месяце' });
            }

            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'legend-item';
                div.innerHTML = `<span class="legend-color" style="background:${item.color}"></span>${item.label}`;
                legend.appendChild(div);
            });
        },

        // ============================================
        // Тултип
        // ============================================
        showTooltip(event, apt) {
            let tooltip = document.getElementById('tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'tooltip';
                tooltip.className = 'tooltip';
                document.body.appendChild(tooltip);
            }
            const status = apt.otherMonth ? '⏳ Продано в другом месяце' : (apt.sold ? '✅ Продано' : '❌ Не продано');
            tooltip.innerHTML = `
                <div class="tt-title">${apt.apt}</div>
                <div>Этаж: ${apt.floor} | Комнат: ${apt.rooms}</div>
                <div>Площадь: ${apt.area} м²</div>
                <div>Планировка: ${apt.plan}</div>
                <div>Вид: ${apt.view || '—'}</div>
                <div>Цена: ${this.formatMoney(apt.price)}</div>
                ${apt.sold ? `<div>Цена продажи: ${this.formatMoney(apt.priceSale)}</div>` : ''}
                ${apt.discount ? `<div>Скидка: ${this.formatMoney(apt.discount)}</div>` : ''}
                <div>Менеджер: ${apt.manager || '—'}</div>
                ${apt.dateDeal ? `<div>Дата сделки: ${apt.dateDeal}</div>` : ''}
                <div>${status}</div>
            `;
            tooltip.style.opacity = 1;
            this.moveTooltip(event);
        },

        moveTooltip(event) {
            const tooltip = document.getElementById('tooltip');
            if (!tooltip) return;
            tooltip.style.left = (event.pageX + 15) + 'px';
            tooltip.style.top = (event.pageY + 15) + 'px';
        },

        hideTooltip() {
            const tooltip = document.getElementById('tooltip');
            if (tooltip) tooltip.style.opacity = 0;
        },

        // Тултип для вспомогательных графиков
        showChartTip(event, html) {
            let tip = document.getElementById('chartTip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'chartTip';
                tip.className = 'tooltip';
                document.body.appendChild(tip);
            }
            tip.innerHTML = html;
            tip.style.opacity = 1;
            this.moveChartTip(event);
        },

        moveChartTip(event) {
            const tip = document.getElementById('chartTip');
            if (!tip) return;
            tip.style.left = (event.pageX + 15) + 'px';
            tip.style.top = (event.pageY + 15) + 'px';
        },

        hideChartTip() {
            const tip = document.getElementById('chartTip');
            if (tip) tip.style.opacity = 0;
        },

        // ============================================
        // Инициализация
        // ============================================
        init() {
            this.renderMainChart();
        }
    },
    mounted() {
        this.$nextTick(() => {
            this.init();
        });
    }
});

app.mount('#app');