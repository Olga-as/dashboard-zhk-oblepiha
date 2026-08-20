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

// Компактный формат крупных чисел:
// 700 000 -> "700 к", 2 440 000 -> "2,4 млн", 1 075 500 000 -> "1,1 млрд"
function formatCompact(value) {
    if (!value) return '0';
    const abs = Math.abs(value);
    if (abs >= 1000000000) {
        // Миллиарды с двумя знаками после запятой: 1 080 000 000 -> "1,08 млрд"
        const b = value / 1000000000;
        const rounded = Math.round(b * 100) / 100;
        return String(rounded).replace('.', ',') + ' млрд';
    }
    if (abs >= 1000000) {
        // Миллионы с одним знаком после запятой: 2 440 000 -> "2,4 млн"
        const m = value / 1000000;
        const rounded = Math.round(m * 10) / 10;
        return String(rounded).replace('.', ',') + ' млн';
    }
    if (abs >= 1000) {
        return (value / 1000).toFixed(0) + ' к';
    }
    return String(value);
}

// Группировка площади по диапазонам (для фильтра по площади и графика «Площадь»)
function areaBucket(area) {
    if (area < 40) return 'до 40 м²';
    if (area < 50) return '40–50 м²';
    if (area < 60) return '50–60 м²';
    if (area < 70) return '60–70 м²';
    if (area < 90) return '70–90 м²';
    if (area < 100) return '90–100 м²';
    return '100+ м²';
}

// Группировка цены по диапазонам (для разбивки по цене)
function priceBucket(price) {
    if (price < 3000000) return 'до 3 млн';
    if (price < 5000000) return '3–5 млн';
    if (price < 8000000) return '5–8 млн';
    if (price < 12000000) return '8–12 млн';
    return '12+ млн';
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

// Ключ недели для даты — понедельник недели (неделя считается Пн–Вс).
// Возвращает строку "ГГГГ-ММ-ДД" (дата понедельника недели).
function weekKey(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay(); // 0 = Вс, 1 = Пн, ..., 6 = Сб
    const diff = (day === 0) ? -6 : 1 - day; // сдвиг к понедельнику
    d.setDate(d.getDate() + diff);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Подпись недели по ключу weekKey: "2022-05-30" -> "30.05"
function weekLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0');
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
            filterMonth: 'all',
            filterFloor: 'all',
            filterRooms: 'all',
            filterPlan: 'all',
            filterArea: 'all',
            filterView: 'all',
            selectedManagers: []
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
        // Доступные значения для фильтров по параметрам.
        // Каждый список зависит от остальных активных фильтров, чтобы показывать
        // только допустимые комбинации (например, при «Этаж: 1» в планировках
        // остаются только те, что реально есть на 1-м этаже).
        floorOptions() {
            return [...new Set(this.filterByParamsExcept('floor').map(a => a.floor))].sort((a, b) => a - b);
        },
        roomOptions() {
            return [...new Set(this.filterByParamsExcept('rooms').map(a => a.rooms))].sort((a, b) => a - b);
        },
        planOptions() {
            return [...new Set(this.filterByParamsExcept('plan').map(a => a.plan).filter(Boolean))].sort();
        },
        areaOptions() {
            return [...new Set(this.filterByParamsExcept('area').map(a => areaBucket(a.area)))].sort();
        },
        viewOptions() {
            return [...new Set(this.filterByParamsExcept('view').map(a => a.view).filter(Boolean))].sort();
        },
        // Квартиры с учётом фильтров по параметрам (этаж, комнаты, планировка, площадь, вид):
        // не подходящие под выбранные фильтры помечаются otherParam и подсвечиваются серым
        paramFilteredApartments() {
            const base = this.monthFilteredApartments;
            const hasFilters =
                (this.filterFloor && this.filterFloor !== 'all') ||
                (this.filterRooms && this.filterRooms !== 'all') ||
                (this.filterPlan && this.filterPlan !== 'all') ||
                (this.filterArea && this.filterArea !== 'all') ||
                (this.filterView && this.filterView !== 'all');
            if (!hasFilters) return base;
            return base.map(a => {
                let match = true;
                if (this.filterFloor !== 'all') match = match && a.floor === Number(this.filterFloor);
                if (this.filterRooms !== 'all') match = match && a.rooms === Number(this.filterRooms);
                if (this.filterPlan !== 'all') match = match && a.plan === this.filterPlan;
                if (this.filterArea !== 'all') match = match && areaBucket(a.area) === this.filterArea;
                if (this.filterView !== 'all') match = match && a.view === this.filterView;
                if (match) return a;
                return { ...a, otherParam: true };
            });
        },
        // Есть ли активные фильтры по параметрам (этаж, комнаты, планировка, площадь, вид)
        hasParamFilters() {
            return (this.filterFloor && this.filterFloor !== 'all') ||
                (this.filterRooms && this.filterRooms !== 'all') ||
                (this.filterPlan && this.filterPlan !== 'all') ||
                (this.filterArea && this.filterArea !== 'all') ||
                (this.filterView && this.filterView !== 'all');
        },
    },
    methods: {
        formatMoney,
        formatNumber,
        // Возвращает квартиры, подходящие под все активные фильтры параметров,
        // кроме фильтра с ключом excludeKey ('floor'|'rooms'|'plan'|'area'|'view').
        // Используется для построения выпадающих списков: каждый список зависит
        // от остальных фильтров, а текущее значение самого фильтра остаётся доступным.
        filterByParamsExcept(excludeKey) {
            const base = this.monthFilteredApartments;
            return base.filter(a => {
                if (excludeKey !== 'floor' && this.filterFloor !== 'all') {
                    if (a.floor !== Number(this.filterFloor)) return false;
                }
                if (excludeKey !== 'rooms' && this.filterRooms !== 'all') {
                    if (a.rooms !== Number(this.filterRooms)) return false;
                }
                if (excludeKey !== 'plan' && this.filterPlan !== 'all') {
                    if (a.plan !== this.filterPlan) return false;
                }
                if (excludeKey !== 'area' && this.filterArea !== 'all') {
                    if (areaBucket(a.area) !== this.filterArea) return false;
                }
                if (excludeKey !== 'view' && this.filterView !== 'all') {
                    if (a.view !== this.filterView) return false;
                }
                return true;
            });
        },
        // Перерисовать все графики (при смене фильтра по месяцу/параметрам)
        renderAll() {
            this.renderMainChart();
            this.renderManagerDynamics();
        },
        // Переключение выбора менеджера в таблице динамики
        toggleManager(name) {
            const idx = this.selectedManagers.indexOf(name);
            if (idx >= 0) {
                this.selectedManagers.splice(idx, 1);
            } else {
                this.selectedManagers.push(name);
            }
            this.renderMainChart();
            this.renderManagerDynamics();
        },

        // Подсветка квартир на схеме ЖК, проданных конкретным менеджером,
        // и обновление фактоидов под его данные (при наведении на имя).
        highlightManager(name) {
            if (!this._cellData) return;
            this._cellData.forEach(c => {
                const r = c.rect;
                if (c.apt.sold && c.apt.manager === name) {
                    r.setAttribute('stroke', 'none');
                    r.setAttribute('fill', c.baseFill);
                } else if (c.apt.sold) {
                    r.setAttribute('stroke', 'none');
                    r.setAttribute('fill', '#d9d9d9');
                } else {
                    r.setAttribute('stroke', 'none');
                    r.setAttribute('fill', c.baseFill);
                }
            });
            // Фактоиды под данные выбранного менеджера
            const mgrSold = (this._mdSold || []).filter(a => a.manager === name);
            const container = document.getElementById('managerDynamics');
            if (container) this.renderFactoids(container, mgrSold, mgrSold, true);
        },

        // Сброс подсветки и возврат фактоидов к общему набору.
        clearManagerHighlight() {
            if (!this._cellData) return;
            this._cellData.forEach(c => {
                c.rect.setAttribute('stroke', 'none');
                c.rect.setAttribute('fill', c.baseFill);
            });
            const container = document.getElementById('managerDynamics');
            if (container) this.renderFactoids(container, this._mdAll || [], this._mdSold || [], false);
        },

        // Подсветка квартир на схеме ЖК, проданных в конкретную неделю (при наведении
        // на столбик/точку графика «Динамика выручки»):
        // — проданные в эту неделю остаются зелёными (baseFill);
        // — непроданные остаются красными (baseFill);
        // — проданные в другие недели становятся серыми.
        highlightWeek(week) {
            if (!this._cellData) return;
            this._cellData.forEach(c => {
                const r = c.rect;
                if (c.apt.sold && c.apt.dateDeal) {
                    const d = parseDate(c.apt.dateDeal);
                    if (d && weekKey(d) === week) {
                        r.setAttribute('stroke', 'none');
                        r.setAttribute('fill', c.baseFill);
                    } else {
                        r.setAttribute('stroke', 'none');
                        r.setAttribute('fill', '#d9d9d9');
                    }
                } else {
                    r.setAttribute('stroke', 'none');
                    r.setAttribute('fill', c.baseFill);
                }
            });
        },

        // Сброс подсветки недели — возврат клеток к базовым цветам.
        clearWeekHighlight() {
            if (!this._cellData) return;
            this._cellData.forEach(c => {
                c.rect.setAttribute('stroke', 'none');
                c.rect.setAttribute('fill', c.baseFill);
            });
        },
        // ============================================
        // ОСНОВНОЙ ГРАФИК: схема дома
        // ============================================
        renderMainChart() {
            const container = document.getElementById('mainChart');
            container.innerHTML = '';
            // Ссылки на клетки квартир для подсветки при наведении на менеджера
            this._cellData = [];
            const width = 1300;
            const height = 660;
            const margin = { top: 70, right: 5, bottom: 130, left: 230 };

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
            const axisX = margin.left - 90;
            const yAxis = d3.axisLeft(yScale)
                .tickValues(d3.range(1, maxFloors + 1))
                .tickFormat(d => d);
            svg.append('g')
                .attr('transform', `translate(${axisX}, 0)`)
                .call(yAxis)
                .selectAll('text')
                .style('font-size', '11px');
            // Рядом с номером этажа выводим продажи: «X из Y (Z%)» по квартирам,
            // подходящим под текущие фильтры (как у подписей корпусов и секций).
            const floorAll = {};
            const floorSold = {};
            this.paramFilteredApartments.forEach(a => {
                if (a.otherParam) return;
                floorAll[a.floor] = (floorAll[a.floor] || 0) + 1;
                if (a.sold && !a.otherMonth) floorSold[a.floor] = (floorSold[a.floor] || 0) + 1;
            });
            d3.range(1, maxFloors + 1).forEach(f => {
                if (!floorAll[f]) return;
                const all = floorAll[f];
                const sold = floorSold[f] || 0;
                const pct = Math.round(sold / all * 100);
                svg.append('text')
                    .attr('x', axisX + 6)
                    .attr('y', yScale(f))
                    .attr('text-anchor', 'start')
                    .attr('dominant-baseline', 'middle')
                    .style('font-size', '9px')
                    .style('fill', '#999')
                    .text(`${sold} из ${all} (${pct}%)`);
            });
            // Подпись «Этаж» слева от шкалы этажей
            svg.append('text')
                .attr('x', axisX - 40)
                .attr('y', (height - margin.bottom + margin.top) / 2)
                .attr('text-anchor', 'middle')
                .attr('transform', `rotate(-90 ${axisX - 40} ${(height - margin.bottom + margin.top) / 2})`)
                .style('font-size', '12px')
                .style('fill', '#666')
                .text('Этаж');
            // Подписи-пояснения слева над шкалой этажей: планировка и площадь
            const legendX = axisX - 6;
            const legendPlanY = yScale(17) - floorH / 2 + 1 - 24;
            const legendAreaY = yScale(17) - floorH / 2 + 1 - 11;
            svg.append('text')
                .attr('x', legendX)
                .attr('y', legendPlanY)
                .attr('text-anchor', 'end')
                .style('font-size', '11px')
                .style('fill', '#666')
                .text('Планировка');
            svg.append('text')
                .attr('x', legendX)
                .attr('y', legendAreaY)
                .attr('text-anchor', 'end')
                .style('font-size', '11px')
                .style('fill', '#888')
                .text('Площадь в м²');

            // Распределяем корпуса по оси X
            // Клетки разной ширины (по комнатам) упаковываются вплотную друг к другу
            const corpKeys = Object.keys(corpStructures);
            const plotWidth = width - margin.left - margin.right;
            // Зазор между домами (покрупнее)
            const corpGap = 20;
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

                        // Если выбраны менеджеры — подсвечиваем только их квартиры,
                        // остальные проданные затемняем и убираем букву
                        const managerSelected = this.selectedManagers.length > 0 &&
                            apt.sold && apt.manager &&
                            this.selectedManagers.includes(apt.manager);
                        const dimmed = this.selectedManagers.length > 0 &&
                            apt.sold && apt.manager &&
                            !this.selectedManagers.includes(apt.manager);

                        let color = this.getCellColor(apt);
                        if (dimmed) color = '#d9d9d9';
                        const cellH = floorH - 2;

                        const rect = svg.append('rect')
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
                        // Сохраняем ссылку на клетку для подсветки по менеджеру
                        this._cellData.push({ rect: rect.node(), apt: apt, baseFill: color });

                        // На проданных квартирах — первая буква имени менеджера
                        // (если выбраны менеджеры — только у выбранных)
                        if (apt.sold && apt.manager && !dimmed) {
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
                        if (!colInfo[a.rowIndex]) colInfo[a.rowIndex] = { rooms: a.rooms, view: a.view, plan: a.plan, area: a.area };
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
                            // Подпись планировки — выше, чтобы под ней поместилась площадь
                            const planY = yScale(corpMaxFloor) - floorH / 2 + 1 - 24;
                            svg.append('text')
                                .attr('x', colXPos)
                                .attr('y', planY)
                                .attr('text-anchor', 'middle')
                                .style('font-size', planFont + 'px')
                                .style('font-weight', 'bold')
                                .style('fill', '#666')
                                .text(info.plan);
                            // Подпись площади — новой строкой под планировкой (~11px над верхним этажом)
                            if (info.area) {
                                svg.append('text')
                                    .attr('x', colXPos)
                                    .attr('y', yScale(corpMaxFloor) - floorH / 2 + 1 - 11)
                                    .attr('text-anchor', 'middle')
                                    .style('font-size', '12px')
                                    .style('fill', '#888')
                                    .text(Math.round(info.area));
                            }
                        }
                        svg.append('text')
                            .attr('x', colXPos)
                            .attr('y', height - 100)
                            .attr('text-anchor', 'middle')
                            .style('font-size', '9px')
                            .style('fill', '#999')
                            .text(label);
                    }

                    // Подпись секции (буква корпуса) — ниже подписей колонок.
                    // Для дома ГП4 рядом с буквой секции (А/Б/В) выводим продажи:
                    // «А  10 из 40 (25%)» — по квартирам, подходящим под текущие фильтры.
                    const secAll = sec.apartments.filter(a => !a.otherParam);
                    const secSold = secAll.filter(a => a.sold && !a.otherMonth);
                    const secPct = secAll.length ? Math.round(secSold.length / secAll.length * 100) : 0;
                    const secLabel = svg.append('text')
                        .attr('x', secX + secWidth / 2)
                        .attr('y', height - 83)
                        .attr('text-anchor', 'middle');
                    secLabel.append('tspan')
                        .attr('font-size', '11px')
                        .attr('fill', '#888')
                        .text(sec.name);
                    if (corp === 'ГП4') {
                        secLabel.append('tspan')
                            .attr('dx', '4')
                            .attr('font-size', '10px')
                            .attr('fill', '#999')
                            .text(`${secSold.length} из ${secAll.length} (${secPct}%)`);
                    }

                    secOff += secWidth + secGap;
                });

                // Название дома и продажи по корпусу в одной строке, по центру дома.
                // «ГП1  20 из 40 (50%)» — между текстами отступ 6px.
                // Продажи считаются по квартирам, подходящим под текущие фильтры.
                const corpAll = this.paramFilteredApartments.filter(a => a.corp === corp && !a.otherParam);
                const corpSold = corpAll.filter(a => a.sold && !a.otherMonth);
                const corpPct = corpAll.length ? Math.round(corpSold.length / corpAll.length * 100) : 0;
                const corpLabel = svg.append('text')
                    .attr('x', pos.x + pos.width / 2)
                    .attr('y', height - 60)
                    .attr('text-anchor', 'middle');
                corpLabel.append('tspan')
                    .attr('font-size', '15px')
                    .attr('font-weight', 'bold')
                    .attr('fill', '#1a2980')
                    .text(corp);
                corpLabel.append('tspan')
                    .attr('dx', '6')
                    .attr('font-size', '12px')
                    .attr('fill', '#666')
                    .text(`${corpSold.length} из ${corpAll.length} (${corpPct}%)`);
            });

            this.renderLegend();
            this.renderManagerDynamics();
        },

        // ============================================
        // Динамика выручки по менеджерам (компактный график справа)
        // Показывает по каждому менеджеру: имя, столбчатый график выручки по неделям,
        // количество сделок, выручку и скидки. Пересчитывается по выбранным фильтрам ЖК.
        // ============================================
        renderManagerDynamics() {
            const container = document.getElementById('managerDynamics');
            if (!container) return;
            container.innerHTML = '';

            // Учитываем только проданные квартиры, подходящие под фильтры
            // (не otherParam — не подходят под фильтры параметров, не otherMonth — проданы в другом месяце)
            // all — квартиры, подходящие под текущие фильтры параметров (без otherParam),
            // sold — проданные из них (без otherMonth — проданных в другом месяце)
            const all = this.paramFilteredApartments.filter(a => !a.otherParam);
            const sold = all.filter(a => a.sold && a.manager && !a.otherMonth);
            // Сохраняем для сброса подсветки/фактоидов при наведении на менеджера
            this._mdAll = all;
            this._mdSold = sold;

            const managers = [...new Set(sold.map(a => a.manager))].sort();

            if (managers.length === 0) {
                container.innerHTML = '<div class="md-title">Динамика выручки по менеджерам</div><div style="color:#999">Нет данных</div>';
                return;
            }

            // Собираем все недели по датам сделок (для общей оси X)
            const weekSet = new Set();
            sold.forEach(a => {
                const d = parseDate(a.dateDeal);
                if (d) weekSet.add(weekKey(d));
            });
            const weeks = [...weekSet].sort();

            // По каждому менеджеру: выручка по неделям + метрики
            const rows = managers.map(m => {
                const mSold = sold.filter(a => a.manager === m);
                const revenue = mSold.reduce((s, a) => s + (a.priceSale || 0), 0);
                const discount = mSold.reduce((s, a) => s + (a.discount || 0), 0);
                const avgDays = mSold.length ? mSold.reduce((s, a) => s + (a.days || 0), 0) / mSold.length : 0;
                const byWeek = {};
                mSold.forEach(a => {
                    const d = parseDate(a.dateDeal);
                    if (d) {
                        const wk = weekKey(d);
                        byWeek[wk] = (byWeek[wk] || 0) + (a.priceSale || 0);
                    }
                });
                return {
                    name: m,
                    count: mSold.length,
                    revenue: revenue,
                    discount: discount,
                    avgDays: avgDays,
                    byWeek: byWeek,
                    color: MANAGER_COLORS[m] || DEFAULT_MANAGER_COLOR
                };
            });

            // Сортируем по выручке (убывание)
            rows.sort((a, b) => b.revenue - a.revenue);

            // Интерактивные фактоиды (пересчитываются по выбранным фильтрам)
            this.renderFactoids(container, all, sold);

            // Заголовок
            const title = document.createElement('div');
            title.className = 'md-title';
            title.textContent = 'Динамика выручки по менеджерам';
            container.appendChild(title);

            // Таблица с 5 колонками: Менеджер | Динамика по неделям | Сделок | Выручка | Скидки
            const table = document.createElement('div');
            table.className = 'md-table';

            // Шапка таблицы
            const header = document.createElement('div');
            header.className = 'md-row md-header';
            header.innerHTML = `
                <div class="md-name">Менеджер</div>
                <div class="md-chart">Динамика, недели</div>
                <div class="md-cell">Сделок</div>
                <div class="md-cell">Выручка</div>
                <div class="md-cell">Скидки</div>
                <div class="md-cell">Скорость</div>
            `;
            table.appendChild(header);

            const chartW = 150, chartH = 34;
            const maxRev = Math.max(...weeks.map(w => rows.reduce((s, r) => s + (r.byWeek[w] || 0), 0)), 1);

            rows.forEach(r => {
                const row = document.createElement('div');
                row.className = 'md-row';

                // Имя менеджера (кликабельное, с подсветкой квартир на схеме ЖК при наведении)
                const name = document.createElement('div');
                name.className = 'md-name md-clickable';
                if (this.selectedManagers.includes(r.name)) {
                    name.classList.add('md-selected');
                }
                name.textContent = r.name;
                name.title = 'Клик — показать только этого менеджера';
                name.addEventListener('click', () => this.toggleManager(r.name));
                name.addEventListener('mouseenter', () => this.highlightManager(r.name));
                name.addEventListener('mouseleave', () => this.clearManagerHighlight());
                row.appendChild(name);

                // Мини-график выручки по неделям (однотонный серый, понасыщеннее)
                const chart = document.createElement('div');
                chart.className = 'md-chart';
                const svg = d3.select(chart).append('svg')
                    .attr('width', chartW)
                    .attr('height', chartH)
                    .attr('viewBox', `0 0 ${chartW} ${chartH}`);

                const x = d3.scaleBand().domain(weeks).range([0, chartW]).padding(0.15);
                const y = d3.scaleLinear().domain([0, maxRev]).range([chartH, 0]);

                svg.selectAll('rect')
                    .data(weeks)
                    .enter().append('rect')
                    .attr('x', w => x(w))
                    .attr('y', w => y(r.byWeek[w] || 0))
                    .attr('width', x.bandwidth())
                    .attr('height', w => chartH - y(r.byWeek[w] || 0))
                    .attr('fill', '#8a93a3')
                    .attr('rx', 1)
                    .on('mouseover', (event, w) => {
                        const val = r.byWeek[w] || 0;
                        this.showChartTip(event, `<b>${r.name}</b><br>Неделя ${weekLabel(w)}<br>Выручка: ${this.formatMoney(val)}`);
                    })
                    .on('mousemove', (event) => this.moveChartTip(event))
                    .on('mouseout', () => this.hideChartTip());
                row.appendChild(chart);

                // Метрики: сделки, выручка, скидки — каждая в своей колонке
                const cellCount = document.createElement('div');
                cellCount.className = 'md-cell';
                cellCount.textContent = r.count;
                row.appendChild(cellCount);

                const cellRevenue = document.createElement('div');
                cellRevenue.className = 'md-cell';
                cellRevenue.textContent = formatCompact(r.revenue);
                row.appendChild(cellRevenue);

                const cellDiscount = document.createElement('div');
                cellDiscount.className = 'md-cell';
                cellDiscount.textContent = formatCompact(r.discount);
                row.appendChild(cellDiscount);

                const cellSpeed = document.createElement('div');
                cellSpeed.className = 'md-cell';
                cellSpeed.textContent = r.avgDays ? r.avgDays.toFixed(0) + ' дн.' : '—';
                row.appendChild(cellSpeed);

                table.appendChild(row);
            });

            container.appendChild(table);

            // График «Динамика выручки» под таблицей (по неделям: количество и сумма продаж)
            this.renderRevenueDynamics(container, sold);
        },

        // ============================================
        // Динамика выручки (общий график по неделям)
        // Показывает по каждой неделе количество проданных квартир (столбцы)
        // и сумму продаж (линия). Пересчитывается по выбранным фильтрам ЖК.
        // ============================================
        renderRevenueDynamics(container, sold) {
            const wrap = document.createElement('div');
            wrap.className = 'rd-wrap';

            const title = document.createElement('div');
            title.className = 'md-title';
            title.textContent = 'Динамика выручки';
            wrap.appendChild(title);

            // Полный диапазон недель — по всем проданным квартирам (без учёта фильтров),
            // чтобы при переключении фильтров график сохранял свои пропорции и показывал
            // все даты недель. Если в какую-то неделю продаж по выбранному фильтру не было,
            // столбик просто не появится (count = 0).
            const allWeeks = new Set();
            this.apartments.forEach(a => {
                if (!a.sold || !a.dateDeal) return;
                const d = parseDate(a.dateDeal);
                if (d) allWeeks.add(weekKey(d));
            });
            const weeks = [...allWeeks].sort();
            if (weeks.length === 0) {
                wrap.innerHTML += '<div style="color:#999">Нет данных</div>';
                container.appendChild(wrap);
                return;
            }

            // Собираем данные по неделям из отфильтрованных продаж: количество и сумму
            const byWeek = {};
            sold.forEach(a => {
                const d = parseDate(a.dateDeal);
                if (!d) return;
                const wk = weekKey(d);
                if (!byWeek[wk]) byWeek[wk] = { count: 0, revenue: 0 };
                byWeek[wk].count += 1;
                byWeek[wk].revenue += (a.priceSale || 0);
            });
            // Для недель без продаж по фильтру подставляем нулевые значения
            weeks.forEach(w => {
                if (!byWeek[w]) byWeek[w] = { count: 0, revenue: 0 };
            });

            const W = 420, H = 160;
            const margin = { top: 16, right: 8, bottom: 24, left: 8 };
            const iw = W - margin.left - margin.right;
            const ih = H - margin.top - margin.bottom;

            const svg = d3.select(wrap).append('svg')
                .attr('width', W)
                .attr('height', H)
                .attr('viewBox', `0 0 ${W} ${H}`)
                .style('display', 'block');

            const x = d3.scaleBand().domain(weeks).range([margin.left, margin.left + iw]).padding(0.2);
            const yCount = d3.scaleLinear().domain([0, d3.max(weeks, w => byWeek[w].count) || 1]).range([margin.top + ih, margin.top]);
            const yRev = d3.scaleLinear().domain([0, d3.max(weeks, w => byWeek[w].revenue) || 1]).range([margin.top + ih, margin.top]);

            // Столбцы — количество проданных квартир
            svg.selectAll('rect.rd-bar')
                .data(weeks)
                .enter().append('rect')
                .attr('class', 'rd-bar')
                .attr('x', w => x(w))
                .attr('y', w => yCount(byWeek[w].count))
                .attr('width', x.bandwidth())
                .attr('height', w => (margin.top + ih) - yCount(byWeek[w].count))
                .attr('fill', '#4e79a7')
                .attr('rx', 1)
                .on('mouseover', (event, w) => {
                    this.highlightWeek(w);
                    this.showChartTip(event,
                        `<b>Неделя ${weekLabel(w)}</b><br>` +
                        `Продано: ${byWeek[w].count} шт.<br>` +
                        `Выручка: ${this.formatMoney(byWeek[w].revenue)}`);
                })
                .on('mousemove', (event) => this.moveChartTip(event))
                .on('mouseout', () => {
                    this.clearWeekHighlight();
                    this.hideChartTip();
                });

            // Линия — сумма продаж по неделям
            const line = d3.line()
                .x(w => x(w) + x.bandwidth() / 2)
                .y(w => yRev(byWeek[w].revenue))
                .curve(d3.curveMonotoneX);

            svg.append('path')
                .datum(weeks)
                .attr('class', 'rd-line')
                .attr('d', line)
                .attr('fill', 'none')
                .attr('stroke', '#e15759')
                .attr('stroke-width', 2);

            // Точки на линии
            svg.selectAll('circle.rd-dot')
                .data(weeks)
                .enter().append('circle')
                .attr('class', 'rd-dot')
                .attr('cx', w => x(w) + x.bandwidth() / 2)
                .attr('cy', w => yRev(byWeek[w].revenue))
                .attr('r', 3)
                .attr('fill', '#e15759')
                .on('mouseover', (event, w) => {
                    this.highlightWeek(w);
                    this.showChartTip(event,
                        `<b>Неделя ${weekLabel(w)}</b><br>` +
                        `Продано: ${byWeek[w].count} шт.<br>` +
                        `Выручка: ${this.formatMoney(byWeek[w].revenue)}`);
                })
                .on('mousemove', (event) => this.moveChartTip(event))
                .on('mouseout', () => {
                    this.clearWeekHighlight();
                    this.hideChartTip();
                });

            // Подписи недель — дата начала недели под каждым столбиком
            svg.selectAll('text.rd-label')
                .data(weeks)
                .enter().append('text')
                .attr('class', 'rd-label')
                .attr('x', w => x(w) + x.bandwidth() / 2)
                .attr('y', margin.top + ih + 14)
                .attr('text-anchor', 'middle')
                .style('font-size', '9px')
                .style('fill', '#666')
                .text(w => weekLabel(w));

            // Легенда
            const legend = document.createElement('div');
            legend.className = 'rd-legend';
            legend.innerHTML = `
                <span class="rd-legend-item"><span class="rd-swatch" style="background:#4e79a7"></span>Кол-во</span>
                <span class="rd-legend-item"><span class="rd-swatch" style="background:#e15759"></span>Выручка</span>
            `;
            wrap.appendChild(legend);

            container.appendChild(wrap);
        },

        // Интерактивные фактоиды над таблицей динамики.
        // Пересчитываются по выбранным фильтрам ЖК (all — все квартиры под фильтрами,
        // sold — проданные из них).
        renderFactoids(container, all, sold, singleManager) {
            // Убираем предыдущие фактоиды (чтобы при наведении на менеджера они обновлялись, а не дублировались)
            const prev = container.querySelector('.md-facts');
            if (prev) prev.remove();

            const totalCount = all.length;
            const soldCount = sold.length;
            const revenue = sold.reduce((s, a) => s + (a.priceSale || 0), 0);
            const discount = sold.reduce((s, a) => s + (a.discount || 0), 0);
            const avgPrice = soldCount ? revenue / soldCount : 0;
            const avgArea = soldCount ? sold.reduce((s, a) => s + (a.area || 0), 0) / soldCount : 0;
            const avgPriceM2 = avgArea ? avgPrice / avgArea : 0;
            const avgDays = soldCount ? sold.reduce((s, a) => s + (a.days || 0), 0) / soldCount : 0;
            const pct = totalCount ? Math.round((soldCount / totalCount) * 100) : 0;

            const facts = document.createElement('div');
            facts.className = 'md-facts';
            facts.innerHTML = `
                <div class="md-fact">
                    <div class="md-fact-label">Выручка по сделкам</div>
                    <div class="md-fact-value">${formatCompact(revenue)}</div>
                </div>
                <div class="md-fact">
                    <div class="md-fact-label">Сделок</div>
                    <div class="md-fact-value">${singleManager ? soldCount : `${soldCount} из ${totalCount} <span class="md-fact-sub">(${pct}%)</span>`}</div>
                </div>
                <div class="md-fact">
                    <div class="md-fact-label">Ср. стоимость квартиры</div>
                    <div class="md-fact-value">${formatCompact(avgPrice)} <span class="md-fact-sub">(${formatCompact(avgPriceM2)}/м²)</span></div>
                </div>
                <div class="md-fact">
                    <div class="md-fact-label">Ср. длит. сделки</div>
                    <div class="md-fact-value">${Math.round(avgDays)} дн.</div>
                </div>
                <div class="md-fact">
                    <div class="md-fact-label">Сумма скидок</div>
                    <div class="md-fact-value">${formatCompact(discount)}</div>
                </div>
            `;
            // Вставляем фактоиды в начало контейнера (над заголовком и таблицей)
            container.insertBefore(facts, container.firstChild);
        },

        // Построение структуры корпусов из данных
        buildCorpStructures() {
            const structures = {};
            const list = this.paramFilteredApartments;
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
            // Квартиры, не подходящие под выбранные фильтры по параметрам — серые
            if (apt.otherParam) return '#bdbdbd';
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
            // Если активны фильтры по параметрам — показываем серые квартиры,
            // не подходящие под выбранные фильтры
            if (this.hasParamFilters) {
                items.push({ color: '#bdbdbd', label: 'Не по фильтру' });
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
            const status = apt.otherParam ? '⏳ Не соответствует фильтру' : (apt.otherMonth ? '⏳ Продано в другом месяце' : (apt.sold ? '✅ Продано' : '❌ Не продано'));
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

        // Тултип для нежилых помещений (магазины)
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