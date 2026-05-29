import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from './firebase';
import { doc, onSnapshot, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy, deleteDoc } from 'firebase/firestore';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './App.css';

// Amavasya dates: 2024-2025 per Hindu panchang (IST), 2026 from astroyogi.com
const AMAWAS_DATES = new Set([
  // 2024
  '2024-01-11','2024-02-09','2024-03-10','2024-04-08','2024-05-08','2024-06-06',
  '2024-07-05','2024-08-04','2024-09-02','2024-10-02','2024-11-01','2024-12-01','2024-12-30',
  // 2025
  '2025-01-29','2025-02-28','2025-03-29','2025-04-27','2025-05-26','2025-06-25',
  '2025-07-24','2025-08-23','2025-09-21','2025-10-21','2025-11-20','2025-12-19',
  // 2026 — source: astroyogi.com (includes Adhik Maas double dates)
  '2026-01-18','2026-02-17',
  '2026-03-18','2026-03-19', // Darsha + Chaitra Amavasya
  '2026-04-17','2026-05-16',
  '2026-06-14','2026-06-15', // Adhik Maas double Amavasya
  '2026-07-14','2026-08-12',
  '2026-09-10','2026-09-11', // Darsha + Bhadrapada Amavasya
  '2026-10-10',
  '2026-11-08','2026-11-09', // Darsha + Kartika Amavasya
  '2026-12-08',
]);

// Eid dates: India/Rajasthan moon-sighting dates
// Eid ul-Fitr 2026: confirmed March 21 (moon not sighted on Mar 19)
// Eid ul-Adha 2026: May 28 (Rajasthan)
const EID_DATES = new Set([
  // Eid ul-Fitr
  '2024-04-11','2025-03-31','2026-03-21',
  // Eid ul-Adha
  '2024-06-17','2025-06-07','2026-05-28',
]);

function CalendarWithLegend({ className, children }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>{children}</div>
      <div className="dp-legend">
        <span><span className="dp-legend-dot dp-legend-amawas" />Amawas</span>
        <span><span className="dp-legend-dot dp-legend-eid" />Eid</span>
      </div>
    </div>
  );
}

function HolidayDatePicker({ value, onChange, className, readOnly, onKeyDown, placeholder }) {
  const selected = value ? new Date(value + 'T00:00:00') : null;

  const handleChange = (date) => {
    const str = date ? date.toLocaleDateString('sv') : '';
    onChange({ target: { value: str } });
  };

  const getDayClass = (date) => {
    const str = date.toLocaleDateString('sv');
    if (AMAWAS_DATES.has(str)) return 'holiday-amawas';
    if (EID_DATES.has(str)) return 'holiday-eid';
    return undefined;
  };

  return (
    <DatePicker
      selected={selected}
      onChange={handleChange}
      dateFormat="dd-MM-yyyy"
      dayClassName={getDayClass}
      className={className}
      onKeyDown={onKeyDown}
      readOnly={readOnly}
      placeholderText={placeholder || 'dd-mm-yyyy'}
      popperProps={{ strategy: 'fixed' }}
      portalId="root"
      showMonthDropdown
      showYearDropdown
      dropdownMode="select"
      fixedHeight
      calendarContainer={CalendarWithLegend}
    />
  );
}

const ASSIGNED_OPTIONS = ["Sunny", "Kamlesh", "Satyanarayan", "Pradeep", "Yogesh", "Naresh C.", "Lokesh", "Jay", "Mahender","Anil"];
const TODAY = new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local timezone
const STATUS_OPTIONS = ["-", "to be started", "in progress", "completed", "stuck"];
const ALL_STATUS_FILTER_OPTIONS = [...STATUS_OPTIONS, 'fraction'];
const DEFAULT_STATUS_FILTER = ALL_STATUS_FILTER_OPTIONS.filter(s => s !== 'completed');
const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5];

function App() {
  const [tasks, setTasks] = useState([
    {
      id: 'initial-1', text: 'Loading...', level: 0, isCollapsed: false,
      assignedTo: [], status: '-', statusType: 'text',
      tillYest: '', today: '', totalTarget: '',
      startDate: '', days: '', endDate: '', remarks: '',
      origStartDate: '', origDays: '', origEndDate: ''
    }
  ]);

  // Multi-project state
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Project rename state
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');

  // Project drag-reorder state
  const [dragProjectId, setDragProjectId] = useState(null);
  const [dragOverProjectId, setDragOverProjectId] = useState(null);

  // Per-project snapshot state: { [projectId]: versionObject }
  const [viewingVersions, setViewingVersions] = useState({});
  const viewingVersion = activeProjectId ? (viewingVersions[activeProjectId] ?? null) : null;

  const setViewingVersion = (valOrUpdater) => {
    if (!activeProjectId) return;
    setViewingVersions(prev => {
      const current = prev[activeProjectId] ?? null;
      const next = typeof valOrUpdater === 'function' ? valOrUpdater(current) : valOrUpdater;
      if (!next) {
        const { [activeProjectId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [activeProjectId]: next };
    });
  };

  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [focusId, setFocusId] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
  const [hoveredTaskId, setHoveredTaskId] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyVersions, setHistoryVersions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showCompletedSection, setShowCompletedSection] = useState(false);
  const [completedCollapsedIds, setCompletedCollapsedIds] = useState(new Set());
  const toggleCompletedCollapse = (id) => setCompletedCollapsedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Filter States
  const [filterSupervisors, setFilterSupervisors] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState(DEFAULT_STATUS_FILTER);
  const [filterLevels, setFilterLevels] = useState([]);
  const [filterDateRange, setFilterDateRange] = useState({ start: '', end: '' });

  // 1. PROJECTS METADATA LISTENER
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'projectsMeta'), (snap) => {
      if (snap.empty) {
        setDoc(doc(db, 'projectsMeta', 'main-project'), {
          name: 'Project 1',
          createdAt: new Date().toISOString(),
          order: 0
        });
      } else {
        const projectList = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        setProjects(projectList);

        setActiveProjectId(prev => {
          if (prev && projectList.some(p => p.id === prev)) return prev;
          const hashId = window.location.hash.slice(1);
          const storedId = localStorage.getItem('wbs-active-project');
          const validIds = new Set(projectList.map(p => p.id));
          if (hashId && validIds.has(hashId)) return hashId;
          if (storedId && validIds.has(storedId)) return storedId;
          return projectList[0]?.id || null;
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. TASKS LISTENER
  useEffect(() => {
    if (!activeProjectId) return;
    setTasks([]); // clear immediately so addTask can't inherit previous project's taskSeq
    const docRef = doc(db, 'projects', activeProjectId);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        let loadedTasks = snapshot.data().tasks;
        // Fix race-condition bug: if taskSeq values don't start at 1, renumber them
        const seqs = loadedTasks.map(t => t.taskSeq).filter(s => s != null && s > 0);
        if (seqs.length > 0) {
          const minSeq = Math.min(...seqs);
          if (minSeq > 1) {
            const offset = minSeq - 1;
            loadedTasks = loadedTasks.map(t => ({
              ...t,
              ...(t.taskSeq != null ? { taskSeq: t.taskSeq - offset } : {})
            }));
            setDoc(docRef, { tasks: loadedTasks }, { merge: true });
          }
        }
        setTasks(loadedTasks);
      } else {
        const defaultTask = [{
          id: `initial-${Date.now()}`, text: 'Project Start', level: 0, isCollapsed: false,
          assignedTo: [], status: '-', statusType: 'text',
          tillYest: '', today: '', totalTarget: '',
          startDate: '', days: '', endDate: '', remarks: '',
          origStartDate: '', origDays: '', origEndDate: ''
        }];
        setDoc(docRef, { tasks: defaultTask });
        setTasks(defaultTask);
      }
    });
    return () => unsubscribe();
  }, [activeProjectId]);

  // 3. SYNC URL hash + localStorage
  useEffect(() => {
    if (activeProjectId) {
      window.location.hash = activeProjectId;
      localStorage.setItem('wbs-active-project', activeProjectId);
    }
  }, [activeProjectId]);

  // FIREBASE HELPERS
  const syncTasks = (newTasks) => {
    setTasks(newTasks);
    if (activeProjectId) {
      setDoc(doc(db, 'projects', activeProjectId), { tasks: newTasks }, { merge: true });
    }
  };

  const saveVersion = async (tasksSnapshot, reportDateSnapshot) => {
    try {
      const projectName = projects.find(p => p.id === activeProjectId)?.name || '';
      await addDoc(collection(db, 'versions'), {
        savedAt: new Date().toISOString(),
        reportDate: reportDateSnapshot,
        tasks: tasksSnapshot,
        projectId: activeProjectId,
        projectName,
      });
    } catch (e) {
      console.error('Failed to save version:', e);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'versions'), orderBy('savedAt', 'desc')));
      setHistoryVersions(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(v => !v.projectId || v.projectId === activeProjectId)
      );
    } catch (e) {
      console.error('Failed to load history:', e);
    }
    setHistoryLoading(false);
  };

  const deleteVersion = async (e, versionId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this snapshot?')) return;
    try {
      await deleteDoc(doc(db, 'versions', versionId));
      setHistoryVersions(prev => prev.filter(v => v.id !== versionId));
      if (viewingVersion?.id === versionId) setViewingVersion(null);
    } catch (err) {
      console.error('Failed to delete version:', err);
    }
  };

  useEffect(() => {
    const handleClick = () => setActiveMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Ref always holds the latest closures for use in the stable keydown handler
  const shortcutRef = useRef({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    shortcutRef.current = {
      handlePrintPDF, handleCombinedReport, loadHistory,
      tasks, viewingVersion, projects, syncTasks,
      setShowOriginal, setShowHistory, setViewingVersion, switchProject,
    };
  });

  useEffect(() => {
    const handleKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey) return;
      // No input guard — e.preventDefault() in each case prevents special chars (e.g. ð on Mac)
      const r = shortcutRef.current;
      // Alt+1–9 → switch to that project tab (e.code is platform-safe with modifier keys)
      if (/^Digit[1-9]$/.test(e.code)) {
        const p = r.projects[parseInt(e.code.slice(5)) - 1];
        if (p) { e.preventDefault(); r.switchProject(p.id); }
        return;
      }
      // Use e.code (physical key) not e.key — Option+letter on Mac produces special chars
      switch (e.code) {
        case 'KeyD': e.preventDefault(); r.setShowOriginal(v => !v); break;
        case 'KeyH': e.preventDefault(); r.setShowHistory(true); r.loadHistory(); break;
        case 'KeyP': e.preventDefault(); if (r.handlePrintPDF) r.handlePrintPDF(); break;
        case 'KeyR': e.preventDefault(); if (r.handleCombinedReport) r.handleCombinedReport(); break;
        case 'BracketLeft': e.preventDefault();
          r.viewingVersion
            ? r.setViewingVersion(v => ({...v, tasks: v.tasks.map(t => ({...t, isCollapsed: true}))}))
            : r.syncTasks(r.tasks.map(t => ({...t, isCollapsed: true})));
          break;
        case 'BracketRight': e.preventDefault();
          r.viewingVersion
            ? r.setViewingVersion(v => ({...v, tasks: v.tasks.map(t => ({...t, isCollapsed: false}))}))
            : r.syncTasks(r.tasks.map(t => ({...t, isCollapsed: false})));
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // PROJECT MANAGEMENT
  const clearFilters = () => {
    setFilterSupervisors([]);
    setFilterStatuses(DEFAULT_STATUS_FILTER);
    setFilterLevels([]);
    setFilterDateRange({ start: '', end: '' });
  };

  // Switching no longer clears snapshot — each project remembers its own viewing state
  const switchProject = (id) => {
    if (id === activeProjectId) return;
    setActiveProjectId(id);
    clearFilters();
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const id = `proj-${Date.now()}`;
    await setDoc(doc(db, 'projectsMeta', id), {
      name,
      createdAt: new Date().toISOString(),
      order: projects.length
    });
    setNewProjectName('');
    setAddingProject(false);
    setActiveProjectId(id);
  };

  const renameProject = async (id, name) => {
    const trimmed = name.trim();
    setEditingProjectId(null);
    if (!trimmed) return;
    await setDoc(doc(db, 'projectsMeta', id), { name: trimmed }, { merge: true });
  };

  const deleteProject = async (id) => {
    if (projects.length <= 1) {
      alert('Cannot delete the last project.');
      return;
    }
    const project = projects.find(p => p.id === id);
    if (!window.confirm(`Delete project "${project?.name}"? All tasks will be permanently deleted.`)) return;
    await deleteDoc(doc(db, 'projectsMeta', id));
    await deleteDoc(doc(db, 'projects', id));
    if (activeProjectId === id) {
      const remaining = projects.filter(p => p.id !== id);
      switchProject(remaining[0].id);
    }
  };

  // PROJECT DRAG-REORDER
  const handleProjectDragStart = (e, projectId) => {
    setDragProjectId(projectId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleProjectDragOver = (e, projectId) => {
    e.preventDefault();
    if (projectId !== dragProjectId) setDragOverProjectId(projectId);
  };

  const handleProjectDrop = (e, targetId) => {
    e.preventDefault();
    if (!dragProjectId || dragProjectId === targetId) {
      setDragProjectId(null);
      setDragOverProjectId(null);
      return;
    }
    const sourceIdx = projects.findIndex(p => p.id === dragProjectId);
    const targetIdx = projects.findIndex(p => p.id === targetId);
    const reordered = [...projects];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    reordered.forEach((p, i) => setDoc(doc(db, 'projectsMeta', p.id), { order: i }, { merge: true }));
    setDragProjectId(null);
    setDragOverProjectId(null);
  };

  const handleProjectDragEnd = () => {
    setDragProjectId(null);
    setDragOverProjectId(null);
  };



  // AUTO-CAPITALIZE
  const capitalizeFirst = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const getSubtaskRange = useCallback((index, taskArr = tasks) => {
    const parentLevel = taskArr[index].level;
    let lastIndex = index;
    for (let i = index + 1; i < taskArr.length; i++) {
      if (taskArr[i].level > parentLevel) lastIndex = i;
      else break;
    }
    return lastIndex;
  }, [tasks]);

  const generateWBSString = (index, taskArr = tasks) => {
    let counters = [0, 0, 0, 0, 0, 0], prev = -1;
    for (let i = 0; i <= index; i++) {
      if (taskArr[i].level > prev) {
        counters.fill(0, taskArr[i].level);
        counters[taskArr[i].level] = 1;
      } else {
        counters[taskArr[i].level]++;
      }
      prev = taskArr[i].level;
    }
    return counters.slice(0, taskArr[index].level + 1).join('.');
  };

  const formatDateShort = (dateStr) => {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y.slice(-2)}`;
  };

  const displayTasks = viewingVersion ? viewingVersion.tasks : tasks;
  const displayReportDate = viewingVersion ? viewingVersion.reportDate : reportDate;

  const isStatusDefault = filterStatuses.length === DEFAULT_STATUS_FILTER.length && DEFAULT_STATUS_FILTER.every(s => filterStatuses.includes(s));

  // WBS numbering excludes old completed tasks so active tasks always number from 1
  const wbsTasks = useMemo(() =>
    displayTasks.filter(t => t.status !== 'completed' || t.completedAt === TODAY),
    [displayTasks]
  );

  const filteredTasks = useMemo(() => {
    const statusDefault = filterStatuses.length === DEFAULT_STATUS_FILTER.length && DEFAULT_STATUS_FILTER.every(s => filterStatuses.includes(s));
    const wbsIndexMap = new Map(wbsTasks.map((t, i) => [t.id, i]));
    return displayTasks.map((task, originalIndex) => ({
      ...task,
      originalIndex,
      wbsIndex: wbsIndexMap.has(task.id) ? wbsIndexMap.get(task.id) : originalIndex,
    })).filter(task => {
      const matchSup = filterSupervisors.length === 0 || task.assignedTo.some(s => filterSupervisors.includes(s));
      let matchStatus = true;
      if (filterStatuses.length > 0) {
        const currentStatusVal = task.statusType === 'fraction' ? 'fraction' : task.status;
        if (statusDefault && currentStatusVal === 'completed') {
          matchStatus = task.completedAt === TODAY;
        } else {
          matchStatus = filterStatuses.includes(currentStatusVal);
        }
      }
      const matchLevel = filterLevels.length === 0 || filterLevels.includes(task.level);
      let matchDate = true;
      if (filterDateRange.start && filterDateRange.end) {
        matchDate = task.endDate ? (task.endDate >= filterDateRange.start && task.endDate <= filterDateRange.end) : false;
      }
      return matchSup && matchStatus && matchLevel && matchDate;
    });
  }, [displayTasks, filterSupervisors, filterStatuses, filterLevels, filterDateRange, wbsTasks]);

  const isFilterActive = filterSupervisors.length > 0 || !isStatusDefault || filterLevels.length > 0 || !!(filterDateRange.start && filterDateRange.end);
  // Drag is allowed when only the status filter deviates (no level/supervisor/date filters)
  const isOnlyStatusDiff = isFilterActive && !isStatusDefault && filterSupervisors.length === 0 && filterLevels.length === 0 && !(filterDateRange.start && filterDateRange.end);

  // visibleTasks: only tasks that are actually rendered (collapse-hidden removed, consecutive DnD indices)
  const visibleTasks = useMemo(() => {
    if (isFilterActive && !isOnlyStatusDiff) return filteredTasks;
    return filteredTasks.filter(task => {
      const idx = task.originalIndex;
      for (let i = 0; i < idx; i++) {
        if (displayTasks[i].isCollapsed) {
          const lvl = displayTasks[i].level;
          let end = i + 1;
          while (end < displayTasks.length && displayTasks[end].level > lvl) end++;
          if (idx > i && idx <= end - 1) return false;
        }
      }
      return true;
    });
  }, [filteredTasks, isFilterActive, isOnlyStatusDiff, displayTasks]);

  // displayList: visibleTasks + ghost ancestor rows injected when filter is active (but not for status-only diff)
  const displayList = useMemo(() => {
    let di = 0;
    if (!isFilterActive || isOnlyStatusDiff) return visibleTasks.map(t => ({ ...t, draggableIdx: di++ }));
const result = [];
    const seenIds = new Set();
    const visibleIds = new Set(visibleTasks.map(t => t.id));
    for (const task of visibleTasks) {
      const ancestors = [];
      let targetLvl = task.level - 1;
      for (let i = task.originalIndex - 1; i >= 0 && targetLvl >= 0; i--) {
        if (displayTasks[i].level === targetLvl) {
          if (!visibleIds.has(displayTasks[i].id)) {
            ancestors.unshift({ ...displayTasks[i], originalIndex: i, isGhost: true, draggableIdx: -1 });
          }
          targetLvl--;
        }
      }
      for (const anc of ancestors) {
        if (!seenIds.has(anc.id)) { seenIds.add(anc.id); result.push(anc); }
      }
      result.push({ ...task, draggableIdx: di++ });
    }
    return result;
  }, [visibleTasks, isFilterActive, isOnlyStatusDiff, displayTasks]);

  const currentProjectName = projects.find(p => p.id === activeProjectId)?.name || 'WBS Project';

  // Completed tasks section: completed tasks not completed today (archived)
  const completedTasksForSection = useMemo(() => {
    if (viewingVersion) return [];
    return displayTasks
      .map((task, i) => ({ ...task, originalIndex: i }))
      .filter(task => task.status === 'completed' && task.completedAt !== TODAY);
  }, [displayTasks, viewingVersion]);

  const completedDisplayList = useMemo(() => {
    if (!completedTasksForSection.length) return [];
    const result = [];
    const seenIds = new Set();
    const completedIds = new Set(completedTasksForSection.map(t => t.id));
    for (const task of completedTasksForSection) {
      if (seenIds.has(task.id)) continue;
      const ancestors = [];
      let targetLvl = task.level - 1;
      for (let i = task.originalIndex - 1; i >= 0 && targetLvl >= 0; i--) {
        if (displayTasks[i].level === targetLvl) {
          if (!seenIds.has(displayTasks[i].id)) {
            ancestors.unshift({ ...displayTasks[i], originalIndex: i, isGhost: !completedIds.has(displayTasks[i].id) });
          }
          targetLvl--;
        }
      }
      for (const anc of ancestors) { seenIds.add(anc.id); result.push(anc); }
      seenIds.add(task.id);
      result.push(task);
    }
    return result;
  }, [completedTasksForSection, displayTasks]);

  // Pre-compute which tasks are hidden in the completed section due to collapsed ancestors
  // Uses completedCollapsedIds (local to completed section) — independent of main WBS state
  const completedHiddenIds = useMemo(() => {
    const hiddenSet = new Set();
    for (let idx = 0; idx < completedDisplayList.length; idx++) {
      const task = completedDisplayList[idx];
      for (let i = idx - 1; i >= 0; i--) {
        const prev = completedDisplayList[i];
        if (prev.level < task.level) {
          if (completedCollapsedIds.has(prev.id) || hiddenSet.has(prev.id)) hiddenSet.add(task.id);
          break;
        }
      }
    }
    return hiddenSet;
  }, [completedDisplayList, completedCollapsedIds]);

  // PDF EXPORT
  const buildProjectTable = (pdfDoc, effectiveTasks, projectName, effectiveReportDate, wbsSource = null, filterInfo = null) => {
    const todayStr = formatDateShort(effectiveReportDate);
    pdfDoc.setFontSize(16);
    pdfDoc.text(`${projectName} Report`, 14, 15);
    pdfDoc.setFontSize(10);
    pdfDoc.text(`Date: ${todayStr}`, 14, 22);
    let headerEndY = 28;
    if (filterInfo) {
      pdfDoc.setFontSize(8);
      pdfDoc.setTextColor(90, 90, 90);
      pdfDoc.text(`Filters: ${filterInfo}`, 14, 28);
      pdfDoc.setTextColor(0, 0, 0);
      headerEndY = 33;
    }

    const tableData = effectiveTasks.map((task, index) => {
      const wbsNum = (wbsSource && task.originalIndex != null)
        ? generateWBSString(task.originalIndex, wbsSource)
        : generateWBSString(index, effectiveTasks);
      const indent = "        ".repeat(task.level);
      let statusText = '';
      if (task.statusType !== 'fraction') {
        if (task.status === 'stuck') statusText = 'STUCK';
        else if (task.status === 'completed') statusText = 'COMPLETED';
        else if (task.status === 'in progress') statusText = 'IN PROGRESS';
        else if (task.status === 'to be started') statusText = 'TO BE STARTED';
        else statusText = '';
      }
      let startStr = formatDateShort(task.startDate); if (startStr === '-') startStr = '';
      if (task.origStartDate && task.origStartDate !== task.startDate) startStr += `\n${formatDateShort(task.origStartDate)}`;
      let daysStr = task.days || '';
      if (task.origDays && String(task.origDays) !== String(task.days)) daysStr += `\n${task.origDays}`;
      let endStr = formatDateShort(task.endDate); if (endStr === '-') endStr = '';
      if (task.origEndDate && task.origEndDate !== task.endDate) endStr += `\n${formatDateShort(task.origEndDate)}`;
      return [wbsNum, indent + task.text, task.assignedTo.join(', ') || '', statusText, startStr, daysStr, endStr, task.remarks || ''];
    });

    autoTable(pdfDoc, {
      startY: headerEndY + 2,
      head: [['WBS', 'TASK DESCRIPTION', 'SUPERVISOR', 'STATUS', 'START', 'DAYS', 'END DATE', 'REMARKS']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 7, cellPadding: 2, valign: 'middle', textColor: [0, 0, 0] },
      columnStyles: {
        0: { cellWidth: 15 }, 1: { cellWidth: 65 }, 2: { cellWidth: 35 },
        3: { cellWidth: 50, halign: 'center' }, 4: { cellWidth: 20, halign: 'center' },
        5: { cellWidth: 12, halign: 'center' }, 6: { cellWidth: 20, halign: 'center' }, 7: { cellWidth: 'auto' }
      },
      didParseCell: (data) => {
        const task = effectiveTasks[data.row.index];
        if (data.section === 'body') {
          if (task.level === 0) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [215, 215, 215]; }
          else if (task.level === 1) data.cell.styles.fillColor = [255, 255, 255];
          else if (task.level === 2) data.cell.styles.fillColor = [248, 248, 248];
          else if (task.level === 3) data.cell.styles.fillColor = [238, 238, 238];
          else if (task.level >= 4) data.cell.styles.fillColor = [228, 228, 228];
          const isStartHighlight = task.startDate === effectiveReportDate;
          const isEndHighlight = task.endDate === effectiveReportDate;
          const isDateCol = (data.column.index === 4 && isStartHighlight) || (data.column.index === 6 && isEndHighlight);
          const isStuck = data.column.index === 3 && task.statusType !== 'fraction' && task.status === 'stuck';
          if (isStuck || isDateCol) {
            data.cell.styles.fillColor = [50, 50, 50];
            data.cell.styles.textColor = [255, 255, 255];
            data.cell.styles.fontStyle = 'bold';
          } else if (data.column.index === 3 && task.statusType !== 'fraction') {
            if (task.status === 'completed') { data.cell.styles.fontStyle = 'italic'; data.cell.styles.textColor = [0, 0, 0]; }
            else if (task.status === 'in progress') data.cell.styles.fontStyle = 'bold';
          }
        }
      },
      willDrawCell: (data) => {
        if (data.section === 'body') {
          const task = effectiveTasks[data.row.index];
          const c = data.column.index;
          let hasDiff = false;
          if (c === 4 && task.origStartDate && task.origStartDate !== task.startDate) hasDiff = true;
          if (c === 5 && task.origDays && String(task.origDays) !== String(task.days)) hasDiff = true;
          if (c === 6 && task.origEndDate && task.origEndDate !== task.endDate) hasDiff = true;
          if (hasDiff || (c === 3 && task.statusType === 'fraction')) data.cell.text = ['', ''];
        }
      },
      didDrawCell: (data) => {
        if (data.section === 'body') {
          const task = effectiveTasks[data.row.index];
          const c = data.column.index;
          if (c === 3 && task.statusType === 'fraction') {
            const yest = parseFloat(task.tillYest) || 0, tod = parseFloat(task.today) || 0;
            const tot = parseFloat(task.totalTarget) || 0, wd = parseFloat(task.days) || 0;
            const expRate = (tot > 0 && wd > 0) ? tot / wd : 0;
            const expDelta = expRate > 0 ? expRate.toFixed(1) : '-';
            const total = yest + tod;
            let expToday = '-';
            if (task.startDate && tot > 0 && wd > 0) {
              const dfs = Math.floor((new Date(effectiveReportDate) - new Date(task.startDate)) / 86400000) + 1;
              expToday = dfs > 0 ? Math.min(dfs * expRate, tot).toFixed(1) : '0';
            }
            pdfDoc.setDrawColor(0, 0, 0); pdfDoc.setLineWidth(0.15);
            const midY = data.cell.y + data.cell.height / 2;
            pdfDoc.line(data.cell.x + 2, midY, data.cell.x + data.cell.width - 2, midY);
            pdfDoc.setFontSize(7); pdfDoc.setFont('helvetica', 'normal'); pdfDoc.setTextColor(0, 0, 0);
            const cx = data.cell.x + data.cell.width / 2;
            pdfDoc.text(`${yest}+${tod}(exp.${expDelta}/d)=${total}`, cx, data.cell.y + data.cell.height / 4, { align: 'center', baseline: 'middle' });
            pdfDoc.text(`${tot}  (Due: ${expToday})`, cx, data.cell.y + 3 * data.cell.height / 4, { align: 'center', baseline: 'middle' });
            return;
          }
          let hasDiff = false, line1 = '', line2 = '';
          if (c === 4 && task.origStartDate && task.origStartDate !== task.startDate) { hasDiff = true; line1 = formatDateShort(task.startDate); line2 = formatDateShort(task.origStartDate); }
          else if (c === 5 && task.origDays && String(task.origDays) !== String(task.days)) { hasDiff = true; line1 = String(task.days || '-'); line2 = String(task.origDays); }
          else if (c === 6 && task.origEndDate && task.origEndDate !== task.endDate) { hasDiff = true; line1 = formatDateShort(task.endDate); line2 = formatDateShort(task.origEndDate); }
          if (hasDiff) {
            const isHL = (c === 4 && task.startDate === effectiveReportDate) || (c === 6 && task.endDate === effectiveReportDate);
            pdfDoc.setDrawColor(...(isHL ? [255, 255, 255] : [0, 0, 0])); pdfDoc.setLineWidth(0.15);
            const midY = data.cell.y + data.cell.height / 2;
            pdfDoc.line(data.cell.x, midY, data.cell.x + data.cell.width, midY);
            pdfDoc.setFontSize(data.cell.styles.fontSize || 7); pdfDoc.setFont('helvetica', 'normal');
            const tc = data.cell.styles.textColor;
            if (Array.isArray(tc)) pdfDoc.setTextColor(tc[0], tc[1], tc[2]); else pdfDoc.setTextColor(0, 0, 0);
            const cx = data.cell.x + data.cell.width / 2;
            pdfDoc.text(line1, cx, data.cell.y + data.cell.height / 4, { align: 'center', baseline: 'middle' });
            pdfDoc.text(line2, cx, data.cell.y + 3 * data.cell.height / 4, { align: 'center', baseline: 'middle' });
          }
        }
      }
    });
  };

  // Print current project
  const handlePrintPDF = () => {
    const effectiveTasksFull = viewingVersion ? viewingVersion.tasks : tasks;
    const effectiveReportDate = viewingVersion ? viewingVersion.reportDate : reportDate;
    const pdfDoc = new jsPDF('l', 'mm', 'a4');
    if (viewingVersion) {
      buildProjectTable(pdfDoc, effectiveTasksFull, currentProjectName, effectiveReportDate);
    } else {
      // filteredTasks already applies TODAY filter + any active filters; originalIndex enables correct WBS
      const filterParts = [];
      if (filterSupervisors.length > 0) filterParts.push(`Supervisors: ${filterSupervisors.join(', ')}`);
      if (!isStatusDefault) filterParts.push(`Status: ${filterStatuses.join(', ')}`);
      if (filterLevels.length > 0) filterParts.push(`Levels: ${filterLevels.map(l => `L${l}`).join(', ')}`);
      if (filterDateRange.start && filterDateRange.end) filterParts.push(`End: ${filterDateRange.start} – ${filterDateRange.end}`);
      const filterInfo = filterParts.length > 0 ? filterParts.join('  |  ') : null;
      buildProjectTable(pdfDoc, filteredTasks, currentProjectName, effectiveReportDate, effectiveTasksFull, filterInfo);
      saveVersion(tasks, reportDate);
    }
    pdfDoc.save(`WBS_${currentProjectName.replace(/\s+/g, '_')}_${effectiveReportDate}.pdf`);
  };

  // Combined report: all projects, always excludes completed tasks (except completed today)
  const handleCombinedReport = async () => {
    const effectiveReportDate = reportDate;
    const pdfDoc = new jsPDF('l', 'mm', 'a4');
    for (let i = 0; i < projects.length; i++) {
      if (i > 0) pdfDoc.addPage();
      const p = projects[i];
      let projectTasks;
      if (p.id === activeProjectId) {
        projectTasks = tasks;
      } else {
        const snap = await getDoc(doc(db, 'projects', p.id));
        projectTasks = snap.exists() ? snap.data().tasks || [] : [];
      }
      const filteredForReport = projectTasks
        .map((t, i) => ({ ...t, originalIndex: i }))
        .filter(t => t.status !== 'completed' || t.completedAt === TODAY);
      buildProjectTable(pdfDoc, filteredForReport, p.name, effectiveReportDate, projectTasks);
    }
    pdfDoc.save(`WBS_Combined_Report_${effectiveReportDate}.pdf`);
    saveVersion(tasks, reportDate);
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
        const diffDays = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
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
        const diffDays = Math.ceil((new Date(origEndDate) - new Date(origStartDate)) / 86400000) + 1;
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
      origStartDate: '', origDays: '', origEndDate: '',
      taskSeq: tasks.reduce((max, t) => Math.max(max, t.taskSeq || 0), 0) + 1,
    });
    syncTasks(newTasks);
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
      syncTasks([{ id: initId, text: '', level: 0, isCollapsed: false, assignedTo: [], status: '-', statusType: 'text', tillYest: '', today: '', totalTarget: '', origStartDate: '', origDays: '', origEndDate: '' }]);
      setFocusId(initId);
    } else {
      syncTasks(copy);
      if (targetId) setFocusId(targetId);
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') { e.preventDefault(); deleteTask(index); return; }
    if (e.key === 'Enter') {
      if (e.target.classList.contains('task-input-field')) { e.preventDefault(); addTask(index); }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      changeLevel(index, e.shiftKey ? -1 : 1);
    }
  };

  const changeLevel = (index, delta) => {
    const start = index;
    const end = tasks[index].isCollapsed ? getSubtaskRange(index) : index;
    syncTasks(tasks.map((t, i) => (i >= start && i <= end) ? { ...t, level: Math.max(0, Math.min(5, t.level + delta)) } : t));
  };

  const toggleSelection = (taskId, field, value) => {
    syncTasks(tasks.map(t => {
      if (t.id === taskId) {
        if (field === 'assignedTo') {
          const current = t.assignedTo || [];
          return { ...t, assignedTo: current.includes(value) ? current.filter(v => v !== value) : [...current, value] };
        }
        let finalValue = value;
        if (field === 'text' || field === 'remarks') finalValue = capitalizeFirst(value);
        const updated = { ...t, [field]: finalValue };
        if (field === 'status') updated.completedAt = value === 'completed' ? TODAY : null;
        if (field === 'statusType') updated.completedAt = null; // switching to fraction clears completion
        return updated;
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

  // Auto-resize all remarks textareas on load and whenever tasks change
  useEffect(() => {
    document.querySelectorAll('.remarks-textarea').forEach(el => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
  }, [tasks]);

  return (
    <div className="App">
      <header className="header">
        <div className="header-top">
          <h1>WBS Pro <small>5.5 (Cloud)</small></h1>
          <div className="header-controls">
            <div className="date-selector">
              <label>Report Date:</label>
              <HolidayDatePicker value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
            <div className="bulk-actions">
              <button className={`secondary-btn orig-toggle-btn ${showOriginal ? 'toggle-active' : ''}`} title="Alt + D" onClick={() => setShowOriginal(p => !p)}>{showOriginal ? 'Hide Original' : 'Show Original'}</button>
              <button className="secondary-btn history-btn" onClick={() => { setShowHistory(true); loadHistory(); }}>History</button>
              <button className="secondary-btn print-btn" onClick={handlePrintPDF}>Print PDF</button>
              <button className="secondary-btn combined-btn" onClick={handleCombinedReport}>Combined Report</button>
              <button className="secondary-btn" onClick={() => viewingVersion ? setViewingVersion(v => ({...v, tasks: v.tasks.map(t => ({...t, isCollapsed: true}))})) : syncTasks(tasks.map(t => ({...t, isCollapsed: true})))}>Collapse All</button>
              <button className="secondary-btn" onClick={() => viewingVersion ? setViewingVersion(v => ({...v, tasks: v.tasks.map(t => ({...t, isCollapsed: false}))})) : syncTasks(tasks.map(t => ({...t, isCollapsed: false})))}>Expand All</button>
              <button className="secondary-btn delete-all" onClick={() => window.confirm("Clear project?") && syncTasks([{ id: 'init', text: '', level: 0, isCollapsed: false, assignedTo: [], status: '-', statusType: 'text', tillYest: '', today: '', totalTarget: '', origStartDate: '', origDays: '', origEndDate: '' }])}>Clear All</button>
            </div>
          </div>
        </div>

        {/* Project Tab Bar */}
        <div className="project-bar">
          <div className="project-tabs">
            {projects.map((p, idx) => (
              <div
                key={p.id}
                className={`project-tab ${p.id === activeProjectId ? 'active' : ''} ${dragOverProjectId === p.id ? 'drag-over' : ''} ${dragProjectId === p.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => handleProjectDragStart(e, p.id)}
                onDragOver={(e) => handleProjectDragOver(e, p.id)}
                onDrop={(e) => handleProjectDrop(e, p.id)}
                onDragEnd={handleProjectDragEnd}
                onClick={() => switchProject(p.id)}
              >
                <span className="project-tab-num">{idx + 1}</span>
                {editingProjectId === p.id ? (
                  <input
                    autoFocus
                    className="project-tab-rename-input"
                    value={editingProjectName}
                    onChange={e => setEditingProjectName(e.target.value)}
                    onBlur={() => renameProject(editingProjectId, editingProjectName)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameProject(editingProjectId, editingProjectName);
                      if (e.key === 'Escape') setEditingProjectId(null);
                      e.stopPropagation();
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="project-tab-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingProjectId(p.id);
                      setEditingProjectName(p.name);
                    }}
                    title="Double-click to rename"
                  >
                    {p.name}
                  </span>
                )}
                {projects.length > 1 && (
                  <button
                    className="project-tab-delete"
                    title="Delete project"
                    onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                  >×</button>
                )}
              </div>
            ))}
          </div>
          {addingProject ? (
            <div className="project-add-form">
              <input
                autoFocus
                type="text"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createProject();
                  if (e.key === 'Escape') { setAddingProject(false); setNewProjectName(''); }
                }}
                placeholder="Project name..."
                className="project-name-input"
              />
              <button className="project-add-confirm" onClick={createProject}>Add</button>
              <button className="project-add-cancel" onClick={() => { setAddingProject(false); setNewProjectName(''); }}>Cancel</button>
            </div>
          ) : (
            <button className="project-add-btn" onClick={() => setAddingProject(true)}>+ New Project</button>
          )}
        </div>

        {viewingVersion && (
          <div className="snapshot-banner">
            <span>Viewing snapshot — Report {formatDateShort(viewingVersion.reportDate)} &nbsp;·&nbsp; saved {new Date(viewingVersion.savedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <button className="snapshot-restore-btn" onClick={() => { if (window.confirm('Restore this snapshot as live data? Current data will be overwritten.')) { syncTasks(viewingVersion.tasks); setViewingVersion(null); } }}>↺ Restore</button>
            <button className="snapshot-back-btn" onClick={() => setViewingVersion(null)}>← Back to Live</button>
          </div>
        )}

      </header>

      <div className="wbs-container">
        <DragDropContext onDragEnd={(result) => {
          if (!result.destination) return;
          if (viewingVersion) return;
          if (isFilterActive && !isOnlyStatusDiff) return;
          const sTask = visibleTasks[result.source.index];
          const dTask = visibleTasks[result.destination.index];
          if (!sTask || !dTask) return;
          const sIdx = sTask.originalIndex;
          const dIdx = dTask.originalIndex;
          const blockSize = (tasks[sIdx].isCollapsed ? getSubtaskRange(sIdx) : sIdx) - sIdx + 1;
          // When destination is collapsed, insert after its entire subtree, not just its root
          const dEnd = tasks[dIdx].isCollapsed ? getSubtaskRange(dIdx) : dIdx;
          const copy = [...tasks];
          const block = copy.splice(sIdx, blockSize);
          copy.splice(dEnd > sIdx ? dEnd - blockSize + 1 : dIdx, 0, ...block);
          syncTasks(copy);
        }}>
          <div className={`wbs-table ${showOriginal ? 'show-original' : ''}`}>

            {/* Controls: filters row + shortcuts row — fused to top of table */}
            <div className="wbs-controls-row">
              <div className="controls-filters">
                <span className="filter-label">Filters:</span>
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
                <div className="filter-item popover-trigger">
                  <button className={`filter-btn ${!isStatusDefault ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu?.type === 'filter-status' ? null : {type: 'filter-status'}); }}>
                    Status ({filterStatuses.length}/{ALL_STATUS_FILTER_OPTIONS.length})
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
                <div className="filter-item date-range-group">
                  <label>Ends:</label>
                  <HolidayDatePicker value={filterDateRange.start} onChange={(e) => setFilterDateRange({...filterDateRange, start: e.target.value})} className="filter-date-input" />
                  <span>–</span>
                  <HolidayDatePicker value={filterDateRange.end} onChange={(e) => setFilterDateRange({...filterDateRange, end: e.target.value})} className="filter-date-input" />
                </div>
                {isFilterActive && <button className="clear-filters-btn" onClick={clearFilters}>Clear ×</button>}
              </div>
              <div className="controls-shortcuts">
                <span className="kbrd"><kbd>Enter</kbd> new</span>
                <span className="kbrd"><kbd>Tab</kbd> indent</span>
                <span className="kbrd"><kbd>Shift+Tab</kbd> outdent</span>
                <span className="kbrd"><kbd>Ctrl+Shift+D</kbd> delete</span>
                <span className="kbrd-divider"></span>
                <span className="kbrd"><kbd>Alt+D</kbd> originals</span>
                <span className="kbrd"><kbd>Alt+H</kbd> history</span>
                <span className="kbrd"><kbd>Alt+P</kbd> print</span>
                <span className="kbrd"><kbd>Alt+R</kbd> combined</span>
                <span className="kbrd"><kbd>Alt+[</kbd> collapse</span>
                <span className="kbrd"><kbd>Alt+]</kbd> expand</span>
                <span className="kbrd"><kbd>Alt+1–9</kbd> switch tab</span>
                <span className="kbrd"><kbd>dbl-click</kbd> rename tab</span>
                <span className="kbrd mac-note">(Mac: Option = Alt)</span>
              </div>
            </div>

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
                  {displayList.map((task) => {
                    const originalIndex = task.originalIndex;
                    const hasChildren = originalIndex < displayTasks.length - 1 && displayTasks[originalIndex + 1].level > task.level;

                    if (task.isGhost) {
                      return (
                        <div key={`ghost-${task.id}`} className={`wbs-row ghost-row level-${task.level}`}>
                          <div className="col drag-handle drag-disabled">⠿</div>
                          <div className="col num-col ghost-num">
                            <div className="wbs-num-wrapper">
                              <span>{generateWBSString(originalIndex, displayTasks)}</span>
                              <span className="task-seq-id">#{task.taskSeq || originalIndex + 1}</span>
                            </div>
                          </div>
                          <div className="col task-col">
                            <div className="task-input-wrapper" style={{ paddingLeft: `${task.level * 24}px` }}>
                              <span className={`collapse-toggle arrow-level-${task.level} ${hasChildren ? '' : 'hidden'}`} style={{ cursor: 'default' }}>
                                {task.isCollapsed ? '▶' : '▼'}
                              </span>
                              <span className="ghost-task-name">{task.text || 'Unnamed'}</span>
                            </div>
                          </div>
                          <div className="col assigned-col" /><div className="col status-col" /><div className="col date-col" /><div className="col day-col" /><div className="col date-col" /><div className="col remarks-col" /><div className="col action-col" />
                        </div>
                      );
                    }

                    const isReadOnly = !!viewingVersion;
                    const isMenuOpen = activeMenu?.id === task.id;
                    const showBlueAccent = task.level === 0 || (hasChildren && task.isCollapsed);
                    const isZoneHovered = hoveredTaskId === task.id;
                    const hasBaseline = !!(task.origStartDate || task.origDays || task.origEndDate);
                    const displayOrigStart = showOriginal && task.origStartDate != null && task.origStartDate !== '';
                    const displayOrigDays = showOriginal && task.origDays != null && task.origDays !== '';
                    const displayOrigEnd = showOriginal && task.origEndDate != null && task.origEndDate !== '';
                    const totTarget = parseFloat(task.totalTarget) || 0;
                    const countDays = parseFloat(task.days) || 0;
                    const expRate = (totTarget > 0 && countDays > 0) ? totTarget / countDays : 0;
                    const expectedDelta = expRate > 0 ? expRate.toFixed(1) : '-';
                    const currentTotal = (parseFloat(task.tillYest) || 0) + (parseFloat(task.today) || 0);
                    let expTodayDisplay = '-';
                    if (task.startDate && totTarget > 0 && countDays > 0) {
                      const daysFromStart = Math.floor((new Date(displayReportDate) - new Date(task.startDate)) / 86400000) + 1;
                      expTodayDisplay = daysFromStart > 0 ? Math.min(daysFromStart * expRate, totTarget).toFixed(1) : '0';
                    }
                    return (
                      <Draggable key={task.id} draggableId={task.id} index={task.draggableIdx} isDragDisabled={(isFilterActive && !isOnlyStatusDiff) || !!viewingVersion}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} onKeyDown={(e) => handleKeyDown(e, originalIndex)} className={`wbs-row level-${task.level} ${showBlueAccent ? 'blue-accent' : ''} ${isMenuOpen ? 'z-top' : ''}`}>
                            <div {...provided.dragHandleProps} className={`col drag-handle ${(isFilterActive && !isOnlyStatusDiff) || !!viewingVersion ? 'drag-disabled' : ''}`}>⠿</div>
                            <div className="col num-col">
                              <div className="wbs-num-wrapper">
                                <span>{generateWBSString(task.wbsIndex, wbsTasks)}</span>
                                <span className="task-seq-id">#{task.taskSeq || originalIndex + 1}</span>
                              </div>
                            </div>
                            <div className="col task-col">
                              <div className="task-input-wrapper" style={{ paddingLeft: `${task.level * 24}px` }}>
                                <button className={`collapse-toggle arrow-level-${task.level} ${hasChildren ? '' : 'hidden'}`} onClick={() => viewingVersion ? setViewingVersion(v => ({...v, tasks: v.tasks.map(t => t.id === task.id ? {...t, isCollapsed: !t.isCollapsed} : t)})) : toggleSelection(task.id, 'isCollapsed', !task.isCollapsed)}>
                                  {task.isCollapsed ? '▶' : '▼'}
                                </button>
                                <input type="text" autoFocus={task.id === focusId} value={task.text} onFocus={() => setFocusId(task.id)} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => !isReadOnly && toggleSelection(task.id, 'text', e.target.value)} className="task-input-field" placeholder="Task name..." readOnly={isReadOnly} />
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
                                          <input type="checkbox" checked={task.assignedTo.includes(opt)} onChange={() => !isReadOnly && toggleSelection(task.id, 'assignedTo', opt)} disabled={isReadOnly} /> {opt}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="col status-col">
                              {task.statusType === 'fraction' ? (
                                <div className="fraction-status-layout">
                                  <div className="frac-grid">
                                    <div className="frac-cell"><input type="number" value={task.tillYest || ''} title="Till Yesterday" onChange={(e) => !isReadOnly && toggleSelection(task.id, 'tillYest', e.target.value)} placeholder="Yest" className="fraction-sub-input" readOnly={isReadOnly} /></div>
                                    <div className="frac-op">+</div>
                                    <div className="frac-cell frac-tod-cell">
                                      <input type="number" value={task.today || ''} title="Today" onChange={(e) => !isReadOnly && toggleSelection(task.id, 'today', e.target.value)} placeholder="Tod" className="fraction-sub-input" readOnly={isReadOnly} />
                                      <span className="frac-exp-day">(exp.{expectedDelta})</span>
                                    </div>
                                    <div className="frac-op">=</div>
                                    <div className="frac-cell frac-total-val">{currentTotal}</div>
                                  </div>
                                  <div className="fraction-divider"></div>
                                  <div className="frac-grid">
                                    <div className="frac-cell">{!isReadOnly && <button className="frac-close-btn" title="Close Tracking" onClick={() => toggleSelection(task.id, 'statusType', 'text')}>×</button>}</div>
                                    <div></div>
                                    <div className="frac-cell frac-due-val">(Due: {expTodayDisplay})</div>
                                    <div></div>
                                    <div className="frac-cell"><input type="number" value={task.totalTarget || ''} title="Total Target" onChange={(e) => !isReadOnly && toggleSelection(task.id, 'totalTarget', e.target.value)} placeholder="Target" className="fraction-sub-input" readOnly={isReadOnly} /></div>
                                  </div>
                                </div>
                              ) : (
                                <div className={`cell-input status-bg-${task.status.replace(/\s+/g, '-')}`}>
                                  <select value={task.status} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => { if (isReadOnly) return; if (e.target.value === 'fraction') { toggleSelection(task.id, 'statusType', 'fraction'); } else { toggleSelection(task.id, 'status', e.target.value); } }} className={`select-clean status-text-${task.status.replace(/\s+/g, '-')}`}>
                                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                    <option value="fraction">progress mode</option>
                                  </select>
                                </div>
                              )}
                            </div>
                            <div className="col date-col" onMouseEnter={() => setHoveredTaskId(task.id)} onMouseLeave={() => setHoveredTaskId(null)}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', alignItems: 'stretch' }}>
                                <div className={`cell-input ${task.startDate === displayReportDate ? 'date-highlight-red' : ''}`}>
                                  <HolidayDatePicker value={task.startDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => !isReadOnly && syncTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'startDate', e.target.value) : t))} className="clean-input date-input" readOnly={isReadOnly} />
                                </div>
                                {displayOrigStart && (
                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '10px', background: '#f1f5f9', borderRadius: '4px', padding: '1px 4px', border: '1px dashed #cbd5e1' }}>
                                    <span style={{ marginRight: '4px', fontWeight: 'bold', color: '#64748b' }}>O:</span>
                                    <input type="date" value={task.origStartDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => syncTasks(tasks.map(t => t.id === task.id ? updateOrigDates(t, 'origStartDate', e.target.value) : t))} className="clean-input date-input" style={{ fontSize: '10px', color: '#475569', padding: '0', background: 'transparent' }} />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="col day-col" onMouseEnter={() => setHoveredTaskId(task.id)} onMouseLeave={() => setHoveredTaskId(null)} style={{ position: 'relative' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', alignItems: 'stretch' }}>
                                <div className="cell-input">
                                  <input type="number" value={task.days || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => !isReadOnly && syncTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'days', e.target.value) : t))} className="clean-input center-text day-input-field" placeholder="0" readOnly={isReadOnly} />
                                </div>
                                {displayOrigDays && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', background: '#f1f5f9', borderRadius: '4px', padding: '1px 4px', border: '1px dashed #cbd5e1' }}>
                                    <span style={{ marginRight: '2px', fontWeight: 'bold', color: '#64748b' }}>O:</span>
                                    <input type="number" value={task.origDays || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => syncTasks(tasks.map(t => t.id === task.id ? updateOrigDates(t, 'origDays', e.target.value) : t))} className="clean-input center-text day-input-field" placeholder="0" style={{ fontSize: '10px', color: '#475569', padding: '0', background: 'transparent', width: '100%' }} />
                                  </div>
                                )}
                              </div>
                              {showOriginal && isZoneHovered && !isReadOnly && (
                                <button className="baseline-hover-btn" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '5px', zIndex: 10, background: hasBaseline ? '#dc2626' : '#2563eb', color: '#ffffff', border: 'none', borderRadius: '4px', padding: '1px 5px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', whiteSpace: 'nowrap' }}
                                  onClick={(e) => { e.stopPropagation(); if (hasBaseline) { syncTasks(tasks.map(t => t.id === task.id ? { ...t, origStartDate: '', origDays: '', origEndDate: '' } : t)); } else { syncTasks(tasks.map(t => t.id === task.id ? { ...t, origStartDate: t.startDate, origDays: t.days, origEndDate: t.endDate } : t)); } }}>
                                  {hasBaseline ? 'Delete Original' : 'Set Original'}
                                </button>
                              )}
                            </div>
                            <div className="col date-col" onMouseEnter={() => setHoveredTaskId(task.id)} onMouseLeave={() => setHoveredTaskId(null)}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', alignItems: 'stretch' }}>
                                <div className={`cell-input ${task.endDate === displayReportDate ? 'date-highlight-red' : ''}`}>
                                  <HolidayDatePicker value={task.endDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => !isReadOnly && syncTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'endDate', e.target.value) : t))} className="clean-input date-input" readOnly={isReadOnly} />
                                </div>
                                {displayOrigEnd && (
                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '10px', background: '#f1f5f9', borderRadius: '4px', padding: '1px 4px', border: '1px dashed #cbd5e1' }}>
                                    <span style={{ marginRight: '4px', fontWeight: 'bold', color: '#64748b' }}>O:</span>
                                    <input type="date" value={task.origEndDate || ''} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onChange={(e) => syncTasks(tasks.map(t => t.id === task.id ? updateOrigDates(t, 'origEndDate', e.target.value) : t))} className="clean-input date-input" style={{ fontSize: '10px', color: '#475569', padding: '0', background: 'transparent' }} />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="col remarks-col">
                              <textarea value={task.remarks} onKeyDown={(e) => handleKeyDown(e, originalIndex)} onInput={(e) => !isReadOnly && handleRemarksInput(e, task.id)} onChange={() => {}} className="remarks-textarea" placeholder="Notes..." rows="1" readOnly={isReadOnly} />
                            </div>
                            <div className="col action-col">
                              {!isReadOnly && <button className="row-delete-btn" title="Ctrl + Shift + D" onClick={() => deleteTask(originalIndex)}>×</button>}
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

        {/* Completed Tasks Section */}
        {!viewingVersion && completedDisplayList.length > 0 && (
          <div className="completed-section">
            <div className="completed-section-header" onClick={() => setShowCompletedSection(v => !v)}>
              <span className="completed-section-chevron">{showCompletedSection ? '▼' : '▶'}</span>
              <span className="completed-section-title">Completed Tasks</span>
              <span className="completed-section-count">({completedTasksForSection.length})</span>
            </div>
            {showCompletedSection && (
              <div className="completed-section-body">
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
                {completedDisplayList.map((task) => {
                  if (completedHiddenIds.has(task.id)) return null;
                  const originalIndex = task.originalIndex;
                  const hasChildren = originalIndex < displayTasks.length - 1 && displayTasks[originalIndex + 1]?.level > task.level;

                  if (task.isGhost) {
                    return (
                      <div key={`cghost-${task.id}`} className={`wbs-row ghost-row level-${task.level}`}>
                        <div className="col drag-handle drag-disabled" style={{ opacity: 0 }}>⠿</div>
                        <div className="col num-col ghost-num">
                          <div className="wbs-num-wrapper">
                            <span>{generateWBSString(originalIndex, displayTasks)}</span>
                            <span className="task-seq-id">#{task.taskSeq || originalIndex + 1}</span>
                          </div>
                        </div>
                        <div className="col task-col">
                          <div className="task-input-wrapper" style={{ paddingLeft: `${task.level * 24}px` }}>
                            <button className={`collapse-toggle completed-ghost-toggle arrow-level-${task.level} ${hasChildren ? '' : 'hidden'}`} onClick={() => toggleCompletedCollapse(task.id)}>
                              {completedCollapsedIds.has(task.id) ? '▶' : '▼'}
                            </button>
                            <span className="ghost-task-name">{task.text || 'Unnamed'}</span>
                          </div>
                        </div>
                        <div className="col assigned-col" /><div className="col status-col" /><div className="col date-col" /><div className="col day-col" /><div className="col date-col" /><div className="col remarks-col" /><div className="col action-col" />
                      </div>
                    );
                  }

                  const showBlueAccent = task.level === 0 || (hasChildren && task.isCollapsed);
                  return (
                    <div key={`completed-${task.id}`} className={`wbs-row level-${task.level} ${showBlueAccent ? 'blue-accent' : ''} completed-task-row`}>
                      <div className="col drag-handle drag-disabled" style={{ opacity: 0 }}>⠿</div>
                      <div className="col num-col">
                        <div className="wbs-num-wrapper">
                          <span>{generateWBSString(originalIndex, displayTasks)}</span>
                          <span className="task-seq-id">#{task.taskSeq || originalIndex + 1}</span>
                        </div>
                      </div>
                      <div className="col task-col">
                        <div className="task-input-wrapper" style={{ paddingLeft: `${task.level * 24}px` }}>
                          <button className={`collapse-toggle arrow-level-${task.level} ${hasChildren ? '' : 'hidden'}`} onClick={() => toggleCompletedCollapse(task.id)}>
                            {completedCollapsedIds.has(task.id) ? '▶' : '▼'}
                          </button>
                          <span className="completed-task-name">{task.text}</span>
                        </div>
                      </div>
                      <div className="col assigned-col completed-data-cell"><span className="completed-cell-text">{task.assignedTo?.join(', ') || '-'}</span></div>
                      <div className="col status-col completed-status-cell"><span className="status-badge status-text-completed">completed</span></div>
                      <div className="col date-col completed-data-cell"><span className="completed-cell-text">{task.startDate || '-'}</span></div>
                      <div className="col day-col completed-data-cell"><span className="completed-cell-text">{task.days || '-'}</span></div>
                      <div className="col date-col completed-data-cell"><span className="completed-cell-text">{task.endDate || '-'}</span></div>
                      <div className="col remarks-col completed-data-cell"><span className="completed-cell-text">{task.remarks || ''}</span></div>
                      <div className="col action-col completed-data-cell">
                        <button className="restore-btn" title="Restore task" onClick={() => toggleSelection(task.id, 'status', '-')}>↺</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Version History Modal */}
      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)}>
          <div className="history-modal" onClick={e => e.stopPropagation()}>
            <div className="history-modal-header">
              <h2>Version History</h2>
              <button className="history-close-btn" onClick={() => setShowHistory(false)}>×</button>
            </div>
            <div className="history-modal-body">
              {historyLoading ? (
                <div className="history-empty">Loading...</div>
              ) : historyVersions.length === 0 ? (
                <div className="history-empty">No saved versions yet. Print a PDF to create the first snapshot.</div>
              ) : (
                historyVersions.map(v => (
                  <div key={v.id} className={`history-item ${viewingVersion?.id === v.id ? 'history-item-active' : ''}`} onClick={() => { setViewingVersion(v); setShowHistory(false); }}>
                    <div className="history-item-info">
                      <div className="history-item-report">{v.projectName ? `${v.projectName} — ` : ''}Report {formatDateShort(v.reportDate)}</div>
                      <div className="history-item-saved">Saved {new Date(v.savedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div style={{display:'flex', gap:'6px'}}>
                      <button className="history-restore-btn" title="Restore this snapshot" onClick={(e) => { e.stopPropagation(); if (window.confirm('Restore this snapshot as live data for the current project? Current data will be overwritten.')) { syncTasks(v.tasks); setShowHistory(false); setViewingVersion(null); } }}>↺</button>
                      <button className="history-delete-btn" title="Delete snapshot" onClick={(e) => deleteVersion(e, v.id)}>🗑</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
