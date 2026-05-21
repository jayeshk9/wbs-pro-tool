import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './App.css';

const ASSIGNED_OPTIONS = ["Sunny", "Kamlesh", "Satyanarayan", "Pradeep", "Yogesh", "Naresh C.", "Lokesh", "Jay", "Mahender","Anil"];
const STATUS_OPTIONS = ["-", "to be started", "in progress", "completed", "stuck"];
const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5];

function App() {
  const [tasks, setTasks] = useState(() => {
    const saved = localStorage.getItem('wbs-v16-data');
    return saved ? JSON.parse(saved) : [
      { 
        id: 'initial-1', text: 'Project Start', level: 0, isCollapsed: false,
        assignedTo: [], status: '-', statusType: 'text',
        tillYest: '', today: '', totalTarget: '',
        startDate: '', days: '', endDate: '', remarks: '',
        origStartDate: '', origDays: '', origEndDate: ''
      }
    ];
  });

  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [focusId, setFocusId] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
  const [hoveredTaskId, setHoveredTaskId] = useState(null);

  // Filter States
  const [filterSupervisors, setFilterSupervisors] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState([]);
  const [filterLevels, setFilterLevels] = useState([]);
  const [filterDateRange, setFilterDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    localStorage.setItem('wbs-v16-data', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    const handleClick = () => setActiveMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const getSubtaskRange = useCallback((index) => {
    const parentLevel = tasks[index].level;
    let lastIndex = index;
    for (let i = index + 1; i < tasks.length; i++) {
      if (tasks[i].level > parentLevel) lastIndex = i;
      else break;
    }
    return lastIndex;
  }, [tasks]);

  const generateWBSString = (index) => {
    let counters = [0, 0, 0, 0, 0, 0], prev = -1;
    for (let i = 0; i <= index; i++) {
      if (tasks[i].level > prev) {
        counters.fill(0, tasks[i].level);
        counters[tasks[i].level] = 1;
      } else {
        counters[tasks[i].level]++;
      }
      prev = tasks[i].level;
    }
    return counters.slice(0, tasks[index].level + 1).join('.');
  };

  const formatDateShort = (dateStr) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y.slice(-2)}`;
  };

  // Filter Logic
  const filteredTasks = useMemo(() => {
    return tasks.map((task, originalIndex) => ({ ...task, originalIndex })).filter(task => {
      const matchSup = filterSupervisors.length === 0 || task.assignedTo.some(s => filterSupervisors.includes(s));
      
      let matchStatus = true;
      if (filterStatuses.length > 0) {
        const currentStatusVal = task.statusType === 'fraction' ? 'fraction' : task.status;
        matchStatus = filterStatuses.includes(currentStatusVal);
      }
      
      const matchLevel = filterLevels.length === 0 || filterLevels.includes(task.level);
      
      let matchDate = true;
      if (filterDateRange.start && filterDateRange.end) {
        matchDate = task.endDate ? (task.endDate >= filterDateRange.start && task.endDate <= filterDateRange.end) : false;
      }

      return matchSup && matchStatus && matchLevel && matchDate;
    });
  }, [tasks, filterSupervisors, filterStatuses, filterLevels, filterDateRange]);

  const isFilterActive = filterSupervisors.length > 0 || filterStatuses.length > 0 || filterLevels.length > 0 || (filterDateRange.start && filterDateRange.end);

  const clearFilters = () => {
    setFilterSupervisors([]);
    setFilterStatuses([]);
    setFilterLevels([]);
    setFilterDateRange({ start: '', end: '' });
  };

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const todayStr = formatDateShort(reportDate);

    doc.setFontSize(16);
    doc.text("Ajmer Estate Project Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Date: ${todayStr}`, 14, 22);

    const capitalizeFirst = (str) => {
      if (!str) return '';
      const trimmed = str.trim();
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    };

    const tableData = tasks.map((task, index) => {
      const wbsNum = generateWBSString(index);
      const taskText = capitalizeFirst(task.text);
      const indent = "        ".repeat(task.level); 

      let statusText = '';
      if (task.statusType === 'fraction') {
        // We leave this blank in the string parsing because we will manually draw it in didDrawCell
        statusText = ''; 
      } else {
        if (task.status === 'stuck') statusText = `!!! STUCK !!!`;
        else if (task.status === 'completed') statusText = `[V] COMPLETED`;
        else if (task.status === 'in progress') statusText = `[>] IN PROGRESS`;
        else if (task.status === 'to be started') statusText = `[-] TO BE STARTED`;
        else statusText = '-';
      }

      let startStr = formatDateShort(task.startDate);
      if (task.origStartDate && task.origStartDate !== task.startDate) {
        startStr += `\n${formatDateShort(task.origStartDate)}`;
      }

      let daysStr = task.days || '-';
      if (task.origDays && String(task.origDays) !== String(task.days)) {
        daysStr += `\n${task.origDays}`;
      }

      let endStr = formatDateShort(task.endDate);
      if (task.origEndDate && task.origEndDate !== task.endDate) {
        endStr += `\n${formatDateShort(task.origEndDate)}`;
      }

      const remarksText = capitalizeFirst(task.remarks) || '-';

      return [
        wbsNum,
        indent + taskText,
        task.assignedTo.join(', ') || '-',
        statusText,
        startStr,
        daysStr,
        endStr,
        remarksText
      ];
    });

    autoTable(doc, {
      startY: 30,
      head: [['WBS', 'TASK DESCRIPTION', 'SUPERVISOR', 'STATUS', 'START', 'DAYS', 'END DATE', 'REMARKS']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 7, cellPadding: 2, valign: 'middle', textColor: [0, 0, 0] },
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 65 },
        2: { cellWidth: 35 },
        3: { cellWidth: 30, halign: 'center' }, 
        4: { cellWidth: 20, halign: 'center' }, 
        5: { cellWidth: 12, halign: 'center' }, 
        6: { cellWidth: 20, halign: 'center' }, 
        7: { cellWidth: 'auto' }
      },
      didParseCell: (data) => {
        const taskIdx = data.row.index;
        const task = tasks[taskIdx];
        
        if (data.section === 'body') {
          if (task.level === 0) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [215, 215, 215]; 
          } else if (task.level === 1) {
            data.cell.styles.fillColor = [255, 255, 255]; 
          } else if (task.level === 2) {
            data.cell.styles.fillColor = [248, 248, 248]; 
          } else if (task.level === 3) {
            data.cell.styles.fillColor = [238, 238, 238]; 
          } else if (task.level >= 4) {
            data.cell.styles.fillColor = [228, 228, 228]; 
          }
          
          const isStartHighlight = task.startDate === reportDate;
          const isEndHighlight = task.endDate === reportDate;
          const isDateColumnHighlighted = (data.column.index === 4 && isStartHighlight) || (data.column.index === 6 && isEndHighlight);
          const isStuckStatusColumn = (data.column.index === 3 && task.statusType !== 'fraction' && task.status === 'stuck');

          if (isStuckStatusColumn || isDateColumnHighlighted) {
            data.cell.styles.fillColor = [50, 50, 50]; 
            data.cell.styles.textColor = [255, 255, 255]; 
            data.cell.styles.fontStyle = 'bold';
          } else if (data.column.index === 3 && task.statusType !== 'fraction') {
            if (task.status === 'completed') {
              data.cell.styles.fontStyle = 'italic';
              data.cell.styles.textColor = [0, 0, 0]; 
            } else if (task.status === 'in progress') {
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
      willDrawCell: (data) => {
        if (data.section === 'body') {
          const taskIdx = data.row.index;
          const task = tasks[taskIdx];
          const colIdx = data.column.index;
          
          let hasDiff = false;
          if (colIdx === 4 && task.origStartDate && task.origStartDate !== task.startDate) hasDiff = true;
          if (colIdx === 5 && task.origDays && String(task.origDays) !== String(task.days)) hasDiff = true;
          if (colIdx === 6 && task.origEndDate && task.origEndDate !== task.endDate) hasDiff = true;
          
          // Blank out text generation for overridden manual drawing cells
          if (hasDiff || (colIdx === 3 && task.statusType === 'fraction')) {
            data.cell.text = ['', ''];
          }
        }
      },
      didDrawCell: (data) => {
        if (data.section === 'body') {
          const taskIdx = data.row.index;
          const task = tasks[taskIdx];
          const colIdx = data.column.index;

          // Fraction Mode Specific Drawing
          if (colIdx === 3 && task.statusType === 'fraction') {
            const yest = parseFloat(task.tillYest) || 0;
            const tod = parseFloat(task.today) || 0;
            const tot = parseFloat(task.totalTarget) || 0;
            const workingDays = parseFloat(task.days) || 0;
            const expDelta = (tot > 0 && workingDays > 0) ? (tot / workingDays).toFixed(1) : '-';

            const line1 = `${yest} + ${tod}`;
            const line2 = `${tot} (Exp: ${expDelta})`;

            // Draw the fraction line
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.15);
            const midY = data.cell.y + (data.cell.height / 2);
            // Added slight padding (2px) on left and right so the line doesn't touch the borders
            doc.line(data.cell.x + 2, midY, data.cell.x + data.cell.width - 2, midY); 

            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);

            const centerX = data.cell.x + data.cell.width / 2;
            const centerY1 = data.cell.y + (data.cell.height / 4);
            const centerY2 = data.cell.y + (3 * data.cell.height / 4);

            doc.text(line1, centerX, centerY1, { align: 'center', baseline: 'middle' });
            doc.text(line2, centerX, centerY2, { align: 'center', baseline: 'middle' });
            return; // Exit early so it doesn't conflict with the date logic
          }
          
          // Existing Date Baseline Drawing Logic
          let hasDiff = false;
          let line1 = '';
          let line2 = '';
          
          if (colIdx === 4 && task.origStartDate && task.origStartDate !== task.startDate) {
            hasDiff = true;
            line1 = formatDateShort(task.startDate);
            line2 = formatDateShort(task.origStartDate);
          } else if (colIdx === 5 && task.origDays && String(task.origDays) !== String(task.days)) {
            hasDiff = true;
            line1 = task.days || '-';
            line2 = String(task.origDays);
          } else if (colIdx === 6 && task.origEndDate && task.origEndDate !== task.endDate) {
            hasDiff = true;
            line1 = formatDateShort(task.endDate);
            line2 = formatDateShort(task.origEndDate);
          }
          
          if (hasDiff) {
            const isStartHighlight = task.startDate === reportDate;
            const isEndHighlight = task.endDate === reportDate;
            const isHighlighted = (colIdx === 4 && isStartHighlight) || (colIdx === 6 && isEndHighlight);
            
            if (isHighlighted) {
              doc.setDrawColor(255, 255, 255);
            } else {
              doc.setDrawColor(0, 0, 0);
            }
            doc.setLineWidth(0.15);
            const midY = data.cell.y + (data.cell.height / 2);
            doc.line(data.cell.x, midY, data.cell.x + data.cell.width, midY);
            
            doc.setFontSize(data.cell.styles.fontSize || 7);
            const fontStyle = data.cell.styles.fontStyle || 'normal';
            doc.setFont('helvetica', fontStyle);
            
            const textColor = data.cell.styles.textColor;
            if (Array.isArray(textColor)) {
              doc.setTextColor(textColor[0], textColor[1], textColor[2]);
            } else {
              doc.setTextColor(0, 0, 0);
            }
            
            const centerX = data.cell.x + data.cell.width / 2;
            const centerY1 = data.cell.y + (data.cell.height / 4);
            const centerY2 = data.cell.y + (3 * data.cell.height / 4);
            
            doc.text(line1, centerX, centerY1, { align: 'center', baseline: 'middle' });
            doc.text(line2, centerX, centerY2, { align: 'center', baseline: 'middle' });
          }
        }
      }
    });

    doc.save(`WBS_Report_${reportDate}.pdf`);
  };

  const updateDates = (task, field, value) => {
    let { startDate, days, endDate } = { ...task, [field]: value };
    if (field === 'startDate' || field === 'days') {
      if (startDate && days && !isNaN(days)) {
        const start = new Date(startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + (parseInt(days) - 1));
        endDate = end.toISOString().split('T')[0];
      }
    } else if (field === 'endDate') {
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        days = diffDays > 0 ? diffDays : '';
      }
    }
    return { ...task, [field]: value, startDate, days, endDate };
  };

  const updateOrigDates = (task, field, value) => {
    let { origStartDate, origDays, origEndDate } = { ...task, [field]: value };
    if (field === 'origStartDate' || field === 'origDays') {
      if (origStartDate && origDays && !isNaN(origDays)) {
        const start = new Date(origStartDate);
        const end = new Date(start);
        end.setDate(start.getDate() + (parseInt(origDays) - 1));
        origEndDate = end.toISOString().split('T')[0];
      }
    } else if (field === 'origEndDate') {
      if (origStartDate && origEndDate) {
        const start = new Date(origStartDate);
        const end = new Date(origEndDate);
        const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        origDays = diffDays > 0 ? diffDays : '';
      }
    }
    return { ...task, [field]: value, origStartDate, origDays, origEndDate };
  };

  const addTask = (afterIndex = null) => {
    const newId = `task-${Date.now()}`;
    const newTasks = [...tasks];
    let insertAt = afterIndex !== null ? (tasks[afterIndex].isCollapsed ? getSubtaskRange(afterIndex) : afterIndex) + 1 : tasks.length;
    let levelToUse = afterIndex !== null ? tasks[afterIndex].level : 0;

    newTasks.splice(insertAt, 0, { 
      id: newId, text: '', level: levelToUse, isCollapsed: false,
      assignedTo: [], status: '-', statusType: 'text',
      tillYest: '', today: '', totalTarget: '',
      startDate: '', days: '', endDate: '', remarks: '',
      origStartDate: '', origDays: '', origEndDate: ''
    });
    setTasks(newTasks);
    setFocusId(newId);
  };

  const deleteTask = (index) => {
    const end = tasks[index].isCollapsed ? getSubtaskRange(index) : index;
    const copy = [...tasks];
    let targetId = null;
    if (copy[end + 1]) targetId = copy[end + 1].id;
    else if (copy[index - 1]) targetId = copy[index - 1].id;

    copy.splice(index, (end - index) + 1);
    
    if (copy.length === 0) {
      const initId = `init-${Date.now()}`;
      setTasks([{ id: initId, text: '', level: 0, isCollapsed: false, assignedTo: [], status: '-', statusType: 'text', tillYest: '', today: '', totalTarget: '', origStartDate: '', origDays: '', origEndDate: '' }]);
      setFocusId(initId);
    } else {
      setTasks(copy);
      if (targetId) setFocusId(targetId);
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      deleteTask(index);
      return;
    }
    if (e.key === 'Enter') { 
      if (e.target.classList.contains('task-input-field')) {
        e.preventDefault(); 
        addTask(index); 
      }
    } else if (e.key === 'Tab') { 
      e.preventDefault(); 
      changeLevel(index, e.shiftKey ? -1 : 1); 
    }
  };

  const changeLevel = (index, delta) => {
    const start = index;
    const end = tasks[index].isCollapsed ? getSubtaskRange(index) : index;
    setTasks(tasks.map((t, i) => (i >= start && i <= end) ? { ...t, level: Math.max(0, Math.min(5, t.level + delta)) } : t));
  };

  const toggleSelection = (taskId, field, value) => {
    setTasks(tasks.map(t => {
      if (t.id === taskId) {
        if (field === 'assignedTo') {
          const current = t.assignedTo || [];
          return { ...t, assignedTo: current.includes(value) ? current.filter(v => v !== value) : [...current, value] };
        }
        return { ...t, [field]: value };
      }
      return t;
    }));
  };

  const handleRemarksInput = (e, id) => {
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = target.scrollHeight + 'px';
    toggleSelection(id, 'remarks', target.value);
  };

  return (
    <div className="App">
      <header className="header">
        <div className="header-top">
          <h1>WBS Pro <small>5.2</small></h1>
          <div className="header-controls">
            <div className="date-selector">
              <label>Report Date:</label>
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
            <div className="bulk-actions">
              <button className="secondary-btn print-btn" onClick={exportToPDF}>Print PDF</button>
              <button className="secondary-btn" onClick={() => setTasks(tasks.map(t => ({...t, isCollapsed: true})))}>Collapse All</button>
              <button className="secondary-btn" onClick={() => setTasks(tasks.map(t => ({...t, isCollapsed: false})))}>Expand All</button>
              <button className="secondary-btn delete-all" onClick={() => window.confirm("Clear project?") && setTasks([{ id: 'init', text: '', level: 0, isCollapsed: false, assignedTo: [], status: '-', statusType: 'text', tillYest: '', today: '', totalTarget: '', origStartDate: '', origDays: '', origEndDate: '' }])}>Clear All</button>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          <div className="filter-group">
            <span className="filter-label">Filters:</span>
            
            {/* Supervisor Filter */}
            <div className="filter-item popover-trigger">
              <button className={`filter-btn ${filterSupervisors.length ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu?.type === 'filter-sup' ? null : {type: 'filter-sup'}); }}>
                Supervisors {filterSupervisors.length > 0 && `(${filterSupervisors.length})`}
              </button>
              {activeMenu?.type === 'filter-sup' && (
                <div className="popover-menu filter-menu" onClick={e => e.stopPropagation()}>
                  <div className="menu-scroll">
                    {ASSIGNED_OPTIONS.map(opt => (
                      <label key={opt} className="menu-item">
                        <input type="checkbox" checked={filterSupervisors.includes(opt)} onChange={() => setFilterSupervisors(prev => prev.includes(opt) ? prev.filter(v => v !== opt) : [...prev, opt])} /> {opt}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Status Filter */}
            <div className="filter-item popover-trigger">
              <button className={`filter-btn ${filterStatuses.length ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu?.type === 'filter-status' ? null : {type: 'filter-status'}); }}>
                Status {filterStatuses.length > 0 && `(${filterStatuses.length})`}
              </button>
              {activeMenu?.type === 'filter-status' && (
                <div className="popover-menu filter-menu" onClick={e => e.stopPropagation()}>
                  <div className="menu-scroll">
                    {STATUS_OPTIONS.map(opt => (
                      <label key={opt} className="menu-item">
                        <input type="checkbox" checked={filterStatuses.includes(opt)} onChange={() => setFilterStatuses(prev => prev.includes(opt) ? prev.filter(v => v !== opt) : [...prev, opt])} /> {opt}
                      </label>
                    ))}
                    <label className="menu-item">
                      <input type="checkbox" checked={filterStatuses.includes('fraction')} onChange={() => setFilterStatuses(prev => prev.includes('fraction') ? prev.filter(v => v !== 'fraction') : [...prev, 'fraction'])} /> Progress Tracking
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Level Filter */}
            <div className="filter-item popover-trigger">
              <button className={`filter-btn ${filterLevels.length ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu?.type === 'filter-level' ? null : {type: 'filter-level'}); }}>
                Levels {filterLevels.length > 0 && `(${filterLevels.length})`}
              </button>
              {activeMenu?.type === 'filter-level' && (
                <div className="popover-menu filter-menu" onClick={e => e.stopPropagation()}>
                  <div className="menu-scroll">
                    {LEVEL_OPTIONS.map(opt => (
                      <label key={opt} className="menu-item">
                        <input type="checkbox" checked={filterLevels.includes(opt)} onChange={() => setFilterLevels(prev => prev.includes(opt) ? prev.filter(v => v !== opt) : [...prev, opt])} /> Level {opt}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Date Range Filter */}
            <div className="filter-item date-range-group">
              <label>Ends Between:</label>
              <input type="date" value={filterDateRange.start} onChange={(e) => setFilterDateRange({...filterDateRange, start: e.target.value})} className="filter-date-input" />
              <span>to</span>
              <input type="date" value={filterDateRange.end} onChange={(e) => setFilterDateRange({...filterDateRange, end: e.target.value})} className="filter-date-input" />
            </div>

            {isFilterActive && <button className="clear-filters-btn" onClick={clearFilters}>Clear Filters ×</button>}
          </div>
        </div>
      </header>

      <div className="wbs-container">
        <DragDropContext onDragEnd={(result) => {
          if (!result.destination) return;
          const sIdx = result.source.index;
          const dIdx = result.destination.index;
          if (isFilterActive) return; 

          const blockSize = (tasks[sIdx].isCollapsed ? getSubtaskRange(sIdx) : sIdx) - sIdx + 1;
          const copy = [...tasks];
          const block = copy.splice(sIdx, blockSize);
          copy.splice(dIdx > sIdx ? dIdx - blockSize + 1 : dIdx, 0, ...block);
          setTasks(copy);
        }}>
          <div className="wbs-table">
            <div className="wbs-row header-row">
              <div className="col drag-handle-placeholder"></div>
              <div className="col num-col">WBS</div>
              <div className="col task-col">TASK DESCRIPTION</div>
              <div className="col assigned-col">SUPERVISOR</div>
              <div className="col status-col">STATUS</div>
              <div className="col date-col">START</div>
              <div className="col day-col">DAYS</div>
              <div className="col date-col">END DATE</div>
              <div className="col remarks-col">REMARKS</div>
              <div className="col action-col"></div>
            </div>

            <Droppable droppableId="wbs-list">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef}>
                  {filteredTasks.map((task, fIndex) => {
                    const originalIndex = task.originalIndex;
                    
                    if (!isFilterActive) {
                      let visible = true;
                      for (let i = 0; i < originalIndex; i++) {
                        if (tasks[i].isCollapsed && originalIndex > i && originalIndex <= getSubtaskRange(i)) visible = false;
                      }
                      if (!visible) return null;
                    }

                    const hasChildren = originalIndex < tasks.length - 1 && tasks[originalIndex + 1].level > task.level;
                    const isMenuOpen = activeMenu?.id === task.id;
                    const showBlueAccent = task.level === 0 || (hasChildren && task.isCollapsed);

                    const isZoneHovered = hoveredTaskId === task.id;
                    const hasBaseline = !!(task.origStartDate || task.origDays || task.origEndDate);

                    const displayOrigStart = isZoneHovered || (task.origStartDate && task.origStartDate !== task.startDate);
                    const displayOrigDays = isZoneHovered || (task.origDays && String(task.origDays) !== String(task.days));
                    const displayOrigEnd = isZoneHovered || (task.origEndDate && task.origEndDate !== task.endDate);

                    const totTarget = parseFloat(task.totalTarget) || 0;
                    const countDays = parseFloat(task.days) || 0;
                    const expectedDelta = (totTarget > 0 && countDays > 0) ? (totTarget / countDays).toFixed(1) : '-';

                    return (
                      <Draggable key={task.id} draggableId={task.id} index={fIndex} isDragDisabled={isFilterActive}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} onKeyDown={(e) => handleKeyDown(e, originalIndex)} className={`wbs-row level-${task.level} ${showBlueAccent ? 'blue-accent' : ''} ${isMenuOpen ? 'z-top' : ''}`}>
                            <div {...provided.dragHandleProps} className="col drag-handle">⠿</div>
                            
                            <div className="col num-col">
                              {generateWBSString(originalIndex)}
                            </div>

                            <div className="col task-col">
                              <div className="task-input-wrapper" style={{ paddingLeft: `${task.level * 24}px` }}>
                                <button className={`collapse-toggle arrow-level-${task.level} ${hasChildren ? '' : 'hidden'}`} onClick={() => toggleSelection(task.id, 'isCollapsed', !task.isCollapsed)}>
                                  {task.isCollapsed ? '▶' : '▼'}
                                </button>
                                <input type="text" autoFocus={task.id === focusId} value={task.text} onFocus={() => setFocusId(task.id)} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => toggleSelection(task.id, 'text', e.target.value)} className="task-input-field" placeholder="Task name..." />
                              </div>
                            </div>

                            <div className="col assigned-col">
                              <div className="cell-input popover-trigger">
                                <div className="names-display">{task.assignedTo?.join('\n') || '-'}</div>
                                <button className="add-icon" onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu?.id === task.id && activeMenu?.type === 'assign' ? null : {id: task.id, type: 'assign'}); }}>+</button>
                                {activeMenu?.id === task.id && activeMenu?.type === 'assign' && (
                                  <div className="popover-menu" onClick={e => e.stopPropagation()}>
                                    <div className="menu-scroll">
                                      {ASSIGNED_OPTIONS.map(opt => (
                                        <label key={opt} className="menu-item">
                                          <input type="checkbox" checked={task.assignedTo.includes(opt)} onChange={() => toggleSelection(task.id, 'assignedTo', opt)} /> {opt}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Dashboard Expected Delta Format Applied Here */}
                            <div className="col status-col">
                              {task.statusType === 'fraction' ? (
                                <div className="fraction-status-layout">
                                  <div className="fraction-numerator">
                                    <input type="number" value={task.tillYest || ''} title="Till Yesterday Progress" onChange={(e) => toggleSelection(task.id, 'tillYest', e.target.value)} placeholder="Yest" className="fraction-sub-input" />
                                    <span className="fraction-operator">+</span>
                                    <input type="number" value={task.today || ''} title="Today Progress" onChange={(e) => toggleSelection(task.id, 'today', e.target.value)} placeholder="Tod" className="fraction-sub-input" />
                                    <button className="status-mode-toggle-btn" title="Close Tracking" onClick={() => toggleSelection(task.id, 'statusType', 'text')}>×</button>
                                  </div>
                                  <div className="fraction-divider"></div>
                                  <div className="fraction-denominator">
                                    <input type="number" value={task.totalTarget || ''} title="Total Target Quantity" onChange={(e) => toggleSelection(task.id, 'totalTarget', e.target.value)} placeholder="Tot" className="fraction-sub-input font-bold" />
                                    <span className="delta-value">(Exp: {expectedDelta})</span>
                                  </div>
                                </div>
                              ) : (
                                <div className={`cell-input status-bg-${task.status.replace(/\s+/g, '-')}`}>
                                  <select 
                                    value={task.status} 
                                    onKeyDown={(e) => handleKeyDown(e, originalIndex)} 
                                    onChange={(e) => {
                                      if (e.target.value === 'fraction') {
                                        toggleSelection(task.id, 'statusType', 'fraction');
                                      } else {
                                        toggleSelection(task.id, 'status', e.target.value);
                                      }
                                    }} 
                                    className={`select-clean status-text-${task.status.replace(/\s+/g, '-')}`}
                                  >
                                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                    <option value="fraction">progress mode</option>
                                  </select>
                                </div>
                              )}
                            </div>

                            {/* Start Date Column */}
                            <div 
                              className="col date-col"
                              onMouseEnter={() => setHoveredTaskId(task.id)}
                              onMouseLeave={() => setHoveredTaskId(null)}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', alignItems: 'stretch' }}>
                                <div className={`cell-input ${task.startDate === reportDate ? 'date-highlight-red' : ''}`}>
                                  <input type="date" value={task.startDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'startDate', e.target.value) : t))} className="clean-input date-input" />
                                </div>
                                {displayOrigStart && (
                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '10px', background: '#f1f5f9', borderRadius: '4px', padding: '1px 4px', border: '1px dashed #cbd5e1' }}>
                                    <span style={{ marginRight: '4px', fontWeight: 'bold', color: '#64748b' }}>O:</span>
                                    <input type="date" value={task.origStartDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateOrigDates(t, 'origStartDate', e.target.value) : t))} className="clean-input date-input" style={{ fontSize: '10px', color: '#475569', padding: '0', background: 'transparent' }} />
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Days Column */}
                            <div 
                              className="col day-col"
                              onMouseEnter={() => setHoveredTaskId(task.id)}
                              onMouseLeave={() => setHoveredTaskId(null)}
                              style={{ position: 'relative' }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', alignItems: 'stretch' }}>
                                <div className="cell-input">
                                  <input type="number" value={task.days || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'days', e.target.value) : t))} className="clean-input center-text day-input-field" placeholder="0" />
                                </div>
                                {displayOrigDays && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', background: '#f1f5f9', borderRadius: '4px', padding: '1px 4px', border: '1px dashed #cbd5e1' }}>
                                    <span style={{ marginRight: '2px', fontWeight: 'bold', color: '#64748b' }}>O:</span>
                                    <input type="number" value={task.origDays || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateOrigDates(t, 'origDays', e.target.value) : t))} className="clean-input center-text day-input-field" placeholder="0" style={{ fontSize: '10px', color: '#475569', padding: '0', background: 'transparent', width: '100%' }} />
                                  </div>
                                )}
                              </div>

                              {isZoneHovered && (
                                <button 
                                  className="baseline-hover-btn"
                                  style={{
                                    position: 'absolute',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    top: '2px',
                                    zIndex: 10,
                                    background: hasBaseline ? '#dc2626' : '#2563eb',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '1px 5px',
                                    fontSize: '9px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                                    whiteSpace: 'nowrap'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (hasBaseline) {
                                      setTasks(tasks.map(t => t.id === task.id ? { ...t, origStartDate: '', origDays: '', origEndDate: '' } : t));
                                    } else {
                                      setTasks(tasks.map(t => t.id === task.id ? { ...t, origStartDate: t.startDate, origDays: t.days, origEndDate: t.endDate } : t));
                                    }
                                  }}
                                >
                                  {hasBaseline ? 'Delete Original' : 'Set Original'}
                                </button>
                              )}
                            </div>

                            {/* End Date Column */}
                            <div 
                              className="col date-col"
                              onMouseEnter={() => setHoveredTaskId(task.id)}
                              onMouseLeave={() => setHoveredTaskId(null)}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', alignItems: 'stretch' }}>
                                <div className={`cell-input ${task.endDate === reportDate ? 'date-highlight-red' : ''}`}>
                                  <input type="date" value={task.endDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'endDate', e.target.value) : t))} className="clean-input date-input" />
                                </div>
                                {displayOrigEnd && (
                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '10px', background: '#f1f5f9', borderRadius: '4px', padding: '1px 4px', border: '1px dashed #cbd5e1' }}>
                                    <span style={{ marginRight: '4px', fontWeight: 'bold', color: '#64748b' }}>O:</span>
                                    <input type="date" value={task.origEndDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateOrigDates(t, 'origEndDate', e.target.value) : t))} className="clean-input date-input" style={{ fontSize: '10px', color: '#475569', padding: '0', background: 'transparent' }} />
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="col remarks-col">
                               <textarea 
                                value={task.remarks} 
                                onKeyDown={(e) => handleKeyDown(e, originalIndex)}
                                onInput={(e) => handleRemarksInput(e, task.id)}
                                className="remarks-textarea" 
                                placeholder="Notes..."
                                rows="1"
                               />
                            </div>

                            <div className="col action-col">
                               <button className="row-delete-btn" title="Ctrl + Shift + D" onClick={() => deleteTask(originalIndex)}>×</button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </DragDropContext>
        
        <div className="footer-bar">
          <button className="main-add-btn" onClick={() => addTask()}>+ Add New Task</button>
          <div className="shortcuts">
            <span><b>Enter</b> New Task</span>
            <span><b>Tab</b> Indent</span>
            <span><b>Shift + Tab</b> Outdent</span>
            <span><b>Ctrl + Shift + D</b> Delete Block</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;