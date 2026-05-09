import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './App.css';

const ASSIGNED_OPTIONS = ["Sunny", "Kamlesh", "Satyanarayan", "Pradeep", "Yogesh", "Naresh", "Lokesh", "Jay"];
const STATUS_OPTIONS = ["-", "to be started", "in progress", "completed", "stuck"];

function App() {
  const [tasks, setTasks] = useState(() => {
    const saved = localStorage.getItem('wbs-v16-data');
    return saved ? JSON.parse(saved) : [
      { 
        id: 'initial-1', text: 'Project Start', level: 0, isCollapsed: false,
        assignedTo: [], status: '-', 
        startDate: '', days: '', endDate: '', remarks: '' 
      }
    ];
  });

  const [focusId, setFocusId] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);

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

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const today = new Date().toLocaleDateString('en-GB', { 
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
    });

    doc.setFontSize(16);
    doc.text("WBS-Project Report", 14, 15);
    doc.setFontSize(10);
    doc.text("Work Breakdown Structure", 14, 22);
    doc.text(today, 14, 28);

    const tableData = tasks.map((task, index) => {
      const wbsNum = generateWBSString(index);
      const indent = "  ".repeat(task.level);
      return [
        wbsNum,
        indent + task.text,
        task.assignedTo.join(', ') || '-',
        task.status,
        task.endDate || '-',
        task.remarks || '-'
      ];
    });

    autoTable(doc, {
      startY: 35,
      head: [['WBS', 'Task', 'Stakeholders', 'Status', 'Due', 'Notes']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillGray: [240, 240, 240], textColor: [50, 50, 50], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 80 },
        2: { cellWidth: 50 },
        3: { cellWidth: 25 },
        4: { cellWidth: 25 },
        5: { cellWidth: 'auto' }
      }
    });

    doc.save(`WBS_Report_${new Date().toISOString().split('T')[0]}.pdf`);
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

  const addTask = (afterIndex = null) => {
    const newId = `task-${Date.now()}`;
    const newTasks = [...tasks];
    let insertAt = afterIndex !== null ? (tasks[afterIndex].isCollapsed ? getSubtaskRange(afterIndex) : afterIndex) + 1 : tasks.length;
    let levelToUse = afterIndex !== null ? tasks[afterIndex].level : 0;

    newTasks.splice(insertAt, 0, { 
      id: newId, text: '', level: levelToUse, isCollapsed: false,
      assignedTo: [], status: '-', startDate: '', days: '', endDate: '', remarks: '' 
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
      setTasks([{ id: initId, text: '', level: 0, isCollapsed: false, assignedTo: [], status: '-' }]);
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
          <h1>WBS Pro <small>5.1</small></h1>
          <div className="bulk-actions">
            <button className="secondary-btn print-btn" onClick={exportToPDF}>Print PDF</button>
            <button className="secondary-btn" onClick={() => setTasks(tasks.map(t => ({...t, isCollapsed: true})))}>Collapse All</button>
            <button className="secondary-btn" onClick={() => setTasks(tasks.map(t => ({...t, isCollapsed: false})))}>Expand All</button>
            <button className="secondary-btn delete-all" onClick={() => window.confirm("Clear project?") && setTasks([{ id: 'init', text: '', level: 0, isCollapsed: false, assignedTo: [], status: '-' }])}>Clear All</button>
          </div>
        </div>
      </header>

      <div className="wbs-container">
        <DragDropContext onDragEnd={(result) => {
          if (!result.destination) return;
          const sIdx = result.source.index;
          const dIdx = result.destination.index;
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
              <div className="col assigned-col">STAKEHOLDERS</div>
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
                  {tasks.map((task, index) => {
                    let visible = true;
                    for (let i = 0; i < index; i++) {
                      if (tasks[i].isCollapsed && index > i && index <= getSubtaskRange(i)) visible = false;
                    }
                    if (!visible) return null;

                    const hasChildren = index < tasks.length - 1 && tasks[index + 1].level > task.level;
                    const isMenuOpen = activeMenu?.id === task.id;

                    return (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided) => (
                          <div ref={provided.innerRef} {...provided.draggableProps} onKeyDown={(e) => handleKeyDown(e, index)} className={`wbs-row level-${task.level} ${task.isCollapsed ? 'collapsed-parent' : ''} ${isMenuOpen ? 'z-top' : ''}`}>
                            <div {...provided.dragHandleProps} className="col drag-handle">⠿</div>
                            
                            <div className="col num-col">
                              {generateWBSString(index)}
                            </div>

                            <div className="col task-col">
                              <div className="task-input-wrapper" style={{ paddingLeft: `${task.level * 24}px` }}>
                                <button className={`collapse-toggle arrow-level-${task.level} ${hasChildren ? '' : 'hidden'}`} onClick={() => toggleSelection(task.id, 'isCollapsed', !task.isCollapsed)}>
                                  {task.isCollapsed ? '▶' : '▼'}
                                </button>
                                <input type="text" autoFocus={task.id === focusId} value={task.text} onFocus={() => setFocusId(task.id)} onKeyDown={(e) => handleKeyDown(e, index)} onChange={(e) => toggleSelection(task.id, 'text', e.target.value)} className="task-input-field" placeholder="Task name..." />
                              </div>
                            </div>

                            <div className="col assigned-col">
                              <div className="cell-input popover-trigger">
                                <div className="names-display">{task.assignedTo?.join(', ') || '-'}</div>
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

                            <div className="col status-col">
                              <div className="cell-input">
                                <select value={task.status} onKeyDown={(e) => handleKeyDown(e, index)} onChange={(e) => toggleSelection(task.id, 'status', e.target.value)} className={`select-clean status-${task.status.replace(/\s+/g, '-')}`}>
                                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                            </div>

                            <div className="col date-col">
                              <div className="cell-input">
                                <input type="date" value={task.startDate} onKeyDown={(e) => handleKeyDown(e, index)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'startDate', e.target.value) : t))} className="clean-input date-input" />
                              </div>
                            </div>

                            <div className="col day-col">
                              <div className="cell-input">
                                <input type="number" value={task.days} onKeyDown={(e) => handleKeyDown(e, index)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'days', e.target.value) : t))} className="clean-input center-text day-input-field" placeholder="0" />
                              </div>
                            </div>

                            <div className="col date-col">
                              <div className="cell-input">
                                <input type="date" value={task.endDate} onKeyDown={(e) => handleKeyDown(e, index)} onChange={(e) => setTasks(tasks.map(t => t.id === task.id ? updateDates(t, 'endDate', e.target.value) : t))} className="clean-input date-input" />
                              </div>
                            </div>

                            <div className="col remarks-col">
                               <textarea 
                                value={task.remarks} 
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                onInput={(e) => handleRemarksInput(e, task.id)}
                                className="remarks-textarea" 
                                placeholder="Notes..."
                                rows="1"
                               />
                            </div>

                            <div className="col action-col">
                               <button className="row-delete-btn" title="Ctrl + Shift + D" onClick={() => deleteTask(index)}>×</button>
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