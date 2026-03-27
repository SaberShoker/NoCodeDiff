import { useState, useCallback, useEffect } from 'react';
import ReactFlow, { 
  useNodesState, 
  useEdgesState,
  Controls,
  Background,
  MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';

// 🔧 Настройки сетки привязки
const SNAP_GRID_SIZE = 10;

// Компонент одной рабочей области
function WorkflowArea({ 
  areaId, 
  title, 
  onClose, 
  isActive,
  onActivate 
}) {
  const [jsonData, setJsonData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Функция округления координат до сетки
  const snapToGrid = useCallback((value) => {
    return Math.round(value / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
  }, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        setJsonData(json);
        setError(null);
        parseWorkflowData(json);
      } catch (err) {
        setError('Ошибка парсинга JSON: ' + err.message);
        setJsonData(null);
      }
    };
    
    reader.onerror = () => {
      setError('Ошибка чтения файла');
    };
    
    reader.readAsText(file);
  };

  const handleReset = () => {
    setJsonData(null);
    setError(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodes([]);
    setEdges([]);
    setIsInitialLoad(true);
  };

  const parseWorkflowData = useCallback((json) => {
    if (!json?.Scheme?.RouteScheme?.Layout) {
      return;
    }

    const routeScheme = json.Scheme.RouteScheme;
    const layout = routeScheme.Layout;
    const blocksCollection = routeScheme.Blocks?.$values || [];
    const edgesCollection = routeScheme.Edges?.$values || [];
    const blocksLayout = layout.BlocksLayout?.$values || [];

    const parsedNodes = blocksLayout.map(blockLayout => {
      const blockId = blockLayout.BlockId;
      const fullBlock = blocksCollection.find(b => b.Id === blockId);
      const blockType = getBlockType(fullBlock);
      
      return {
        id: blockId,
        position: { 
          x: snapToGrid(blockLayout.Bounds.X),
          y: snapToGrid(blockLayout.Bounds.Y)
        },
        data: { 
          label: fullBlock?.Title || blockId,
          blockType: blockType
        },
        style: getBlockStyle(blockType, false),
        draggable: true,
        className: 'workflow-node'
      };
    });

    const parsedEdges = edgesCollection.map(edge => ({
      id: `edge-${edge.Id}`,
      source: edge.Source,
      target: edge.Target,
      label: edge.Value || '',
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#555', strokeWidth: 2 },
      markerEnd: {
        type: 'arrowclosed',
        color: '#555'
      },
      data: {
        edgeValue: edge.Value
      }
    }));

    setNodes(parsedNodes);
    setEdges(parsedEdges);
  }, [setNodes, setEdges, snapToGrid]);

  useEffect(() => {
    if (nodes.length > 0 && isInitialLoad) {
      const timer = setTimeout(() => {
        setIsInitialLoad(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, isInitialLoad]);

  const onNodeDragStop = useCallback((event, node) => {
    const snappedPosition = {
      x: snapToGrid(node.position.x),
      y: snapToGrid(node.position.y)
    };

    setNodes(nds => nds.map(n => {
      if (n.id === node.id) {
        return {
          ...n,
          position: snappedPosition
        };
      }
      return n;
    }));
  }, [setNodes, snapToGrid]);

  const onNodeClick = useCallback((event, node) => {
    onActivate(areaId);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    
    setNodes(nds => nds.map(n => {
      if (n.id === node.id) {
        return {
          ...n,
          style: {
            ...getBlockStyle(n.data.blockType, true),
            outline: '3px solid #007bff',
            outlineOffset: '2px',
            zIndex: 999
          }
        };
      } else {
        return {
          ...n,
          style: {
            ...getBlockStyle(n.data.blockType, false),
            outline: 'none',
            zIndex: 1
          }
        };
      }
    }));
  }, [setNodes, areaId, onActivate]);

  const onEdgeClick = useCallback((event, edge) => {
    onActivate(areaId);
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    
    setEdges(eds => eds.map(e => {
      if (e.id === edge.id) {
        return {
          ...e,
          style: { 
            stroke: '#007bff', 
            strokeWidth: 4,
            strokeLinecap: 'round'
          },
          animated: true,
          markerEnd: {
            type: 'arrowclosed',
            color: '#007bff'
          }
        };
      } else {
        return {
          ...e,
          style: { stroke: '#555', strokeWidth: 2 },
          animated: false,
          markerEnd: {
            type: 'arrowclosed',
            color: '#555'
          }
        };
      }
    }));
  }, [setEdges, areaId, onActivate]);

  const onPaneClick = useCallback(() => {
    onActivate(areaId);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    
    setNodes(nds => nds.map(n => ({
      ...n,
      style: {
        ...getBlockStyle(n.data.blockType, false),
        outline: 'none',
        zIndex: 1
      }
    })));
    
    setEdges(eds => eds.map(e => ({
      ...e,
      style: { stroke: '#555', strokeWidth: 2 },
      animated: false,
      markerEnd: {
        type: 'arrowclosed',
        color: '#555'
      }
    })));
  }, [setNodes, setEdges, areaId, onActivate]);

  function getBlockType(block) {
    if (!block) return 'unknown';
    
    const type = block.$type || '';
    if (type.includes('StartBlock')) return 'start';
    if (type.includes('FinishBlock')) return 'finish';
    if (type.includes('AssignmentBlock')) return 'assignment';
    if (type.includes('DecisionBlock')) return 'decision';
    if (type.includes('ScriptBlock')) return 'script';
    if (type.includes('WaitingBlock')) return 'waiting';
    if (type.includes('NoticeBlock')) return 'notice';
    if (type.includes('TaskBlock')) return 'task';
    return 'default';
  }

  function getBlockStyle(blockType, isSelected) {
    const baseStyles = {
      start: { border: '2px solid #28a745', backgroundColor: '#d4edda' },
      finish: { border: '2px solid #dc3545', backgroundColor: '#f8d7da' },
      assignment: { border: '2px solid #007bff', backgroundColor: '#fff' },
      decision: { border: '2px solid #ffc107', backgroundColor: '#fff3cd' },
      script: { border: '2px solid #6f42c1', backgroundColor: '#f3e5f5' },
      waiting: { border: '2px solid #17a2b8', backgroundColor: '#d1ecf1' },
      notice: { border: '2px solid #6c757d', backgroundColor: '#e2e3e5' },
      task: { border: '2px solid #fd7e14', backgroundColor: '#fff' },
      default: { border: '2px solid #007bff', backgroundColor: '#fff' },
      unknown: { border: '2px solid #999', backgroundColor: '#f5f5f5' }
    };

    const style = baseStyles[blockType] || baseStyles.default;
    
    return {
      ...style,
      borderRadius: '8px',
      padding: '10px',
      minWidth: '150px',
      fontSize: '12px',
      fontWeight: isSelected ? 'bold' : 'normal',
      borderColor: isSelected ? '#007bff' : style.borderColor,
      borderWidth: isSelected ? '3px' : '2px',
      boxSizing: 'border-box'
    };
  }

  // Экран загрузки файла
  if (!jsonData) {
    return (
      <div style={{ 
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#f5f5f5',
        padding: '20px',
        boxSizing: 'border-box',
        border: isActive ? '3px solid #007bff' : '3px solid transparent',
        borderRadius: '12px',
        position: 'relative'
      }}>
        {/* Кнопка закрытия области */}
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            padding: '6px 12px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            zIndex: 1001
          }}
        >
          ✕ Закрыть
        </button>

        <div style={{ 
          padding: '40px', 
          textAlign: 'center',
          border: '2px dashed #ccc',
          borderRadius: '12px',
          backgroundColor: 'white',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          maxWidth: '400px',
          width: '100%'
        }}>
          <h3 style={{ marginBottom: '15px', color: '#333' }}>
            {title}
          </h3>
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '20px' }}>
            Загрузите JSON файл со схемой маршрута
          </p>
          <input 
            type="file" 
            accept=".json" 
            onChange={handleFileUpload}
            style={{ 
              margin: '10px',
              padding: '10px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
          {error && (
            <p style={{ color: 'red', marginTop: '15px', fontSize: '13px' }}>{error}</p>
          )}
        </div>
      </div>
    );
  }

  // Проверка структуры данных
  if (!jsonData?.Scheme?.RouteScheme?.Layout?.BlocksLayout) {
    return (
      <div style={{ 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        backgroundColor: '#f5f5f5',
        padding: '20px',
        boxSizing: 'border-box',
        border: isActive ? '3px solid #007bff' : '3px solid transparent',
        borderRadius: '12px',
        position: 'relative'
      }}>
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            padding: '6px 12px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            zIndex: 1001
          }}
        >
          ✕ Закрыть
        </button>

        <div style={{ 
          padding: '30px', 
          textAlign: 'center',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          maxWidth: '400px'
        }}>
          <p style={{ color: 'red', marginBottom: '15px' }}>Неверная структура JSON</p>
          <button 
            onClick={handleReset} 
            style={{ 
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Загрузить другой файл
          </button>
        </div>
      </div>
    );
  }

  // Отображение схемы
  return (
    <div style={{ 
      width: '100%',
      height: '100%',
      position: 'relative',
      border: isActive ? '3px solid #007bff' : '3px solid transparent',
      borderRadius: '12px',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      {/* Заголовок области */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(255,255,255,0.95)',
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: '13px',
        fontWeight: '600',
        pointerEvents: 'none'
      }}>
        <span style={{ color: '#007bff' }}>{title}</span>
        <span style={{ marginLeft: '15px', color: '#666' }}>
          {nodes.length} блоков • {edges.length} связей
        </span>
        {selectedNodeId && (
          <span style={{ marginLeft: '15px', color: '#dc3545' }}>
            Выбран: {selectedNodeId}
          </span>
        )}
      </div>

      {/* Кнопка сброса */}
      <button 
        onClick={handleReset}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 1000,
          padding: '8px 16px',
          backgroundColor: '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '500',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          transition: 'background-color 0.2s'
        }}
        onMouseOver={(e) => e.target.style.backgroundColor = '#c82333'}
        onMouseOut={(e) => e.target.style.backgroundColor = '#dc3545'}
      >
        📁 Новый файл
      </button>

      {/* Панель информации о выбранном блоке */}
      {selectedNodeId && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.95)',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid #ddd',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          maxWidth: '300px',
          fontSize: '12px',
          pointerEvents: 'none'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#007bff' }}>
            📋 Блок
          </div>
          <div><strong>ID:</strong> {selectedNodeId}</div>
          <div><strong>Название:</strong> {
            nodes.find(n => n.id === selectedNodeId)?.data?.label || 'N/A'
          }</div>
          <div><strong>Позиция:</strong> {
            Math.round(nodes.find(n => n.id === selectedNodeId)?.position?.x) || 0}, {
            Math.round(nodes.find(n => n.id === selectedNodeId)?.position?.y) || 0}
          </div>
        </div>
      )}

      {/* ReactFlow */}
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        fitView={isInitialLoad}
        fitViewOptions={{ padding: 0.2, duration: 0 }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        snapToGrid={true}
        snapGrid={[SNAP_GRID_SIZE, SNAP_GRID_SIZE]}
        zoomOnScroll={true}
        panOnScroll={true}
        panOnDrag={true}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#555', strokeWidth: 2 },
          markerEnd: {
            type: 'arrowclosed',
            color: '#555'
          }
        }}
        style={{ 
          width: '100%', 
          height: '100%',
          backgroundColor: '#fafafa'
        }}
      >
        <Controls showInteractive={false} />
        <Background color="#ccc" gap={SNAP_GRID_SIZE} size={1} />
        <MiniMap 
          nodeStrokeColor={(n) => {
            if (n.id === selectedNodeId) return '#007bff';
            return '#555';
          }}
          nodeColor={(n) => {
            if (n.id === selectedNodeId) return '#bbdefb';
            return '#fff';
          }}
          nodeBorderRadius={8}
          style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #ddd',
            width: '120px',
            height: '80px'
          }}
        />
      </ReactFlow>
    </div>
  );
}

// Главный компонент
function WorkflowViewer() {
  const [areas, setAreas] = useState([
    { id: 1, title: 'Схема 1', active: true }
  ]);
  const [activeAreaId, setActiveAreaId] = useState(1);

  const addArea = () => {
    if (areas.length >= 2) return; // Максимум 2 области
    const newId = Math.max(...areas.map(a => a.id)) + 1;
    setAreas([...areas, { id: newId, title: `Схема ${newId}`, active: false }]);
  };

  const removeArea = (id) => {
    if (areas.length <= 1) return; // Минимум 1 область
    const newAreas = areas.filter(a => a.id !== id);
    setAreas(newAreas);
    if (activeAreaId === id) {
      setActiveAreaId(newAreas[0].id);
    }
  };

  const activateArea = (id) => {
    setActiveAreaId(id);
    setAreas(areas.map(a => ({
      ...a,
      active: a.id === id
    })));
  };

  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: '#e8e8e8',
      padding: '10px',
      boxSizing: 'border-box'
    }}>
      {/* Верхняя панель управления */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
        padding: '10px 15px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <div style={{ fontSize: '16px', fontWeight: '600', color: '#333' }}>
          🗂️ Просмотр схем маршрутов
          <span style={{ marginLeft: '15px', fontSize: '13px', color: '#666' }}>
            ({areas.length} из 2 областей активно)
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {areas.length < 2 && (
            <button 
              onClick={addArea}
              style={{
                padding: '10px 20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#218838'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#28a745'}
            >
              + Добавить схему
            </button>
          )}
          <button 
            onClick={() => {
              setAreas([{ id: 1, title: 'Схема 1', active: true }]);
              setActiveAreaId(1);
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#5a6268'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#6c757d'}
          >
            🔄 Сбросить всё
          </button>
        </div>
      </div>

      {/* Рабочие области */}
      <div style={{
        display: 'flex',
        gap: '10px',
        height: 'calc(100vh - 80px)',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {areas.map(area => (
          <div 
            key={area.id}
            style={{
              flex: 1,
              minWidth: 0,
              position: 'relative'
            }}
          >
            <WorkflowArea
              areaId={area.id}
              title={area.title}
              onClose={() => removeArea(area.id)}
              isActive={area.active}
              onActivate={activateArea}
            />
          </div>
        ))}
      </div>

      {/* CSS стили */}
      <style>{`
        .workflow-node {
          transition: outline 0.15s ease-in-out, border-color 0.15s ease-in-out;
          cursor: grab;
          box-sizing: border-box;
          user-select: none;
          -webkit-user-select: none;
        }
        
        .workflow-node:active {
          cursor: grabbing;
        }
        
        .workflow-node:hover {
          filter: brightness(0.97);
        }
        
        .workflow-node.selected {
          outline: 3px solid #007bff;
          outline-offset: 2px;
        }
        
        .react-flow__node {
          cursor: grab;
        }
        
        .react-flow__node:active {
          cursor: grabbing;
        }
        
        .react-flow__edge {
          cursor: pointer;
        }
        
        .react-flow__edge-path {
          stroke-width: 2px;
          transition: stroke 0.15s ease-in-out, stroke-width 0.15s ease-in-out;
        }
        
        .react-flow__edge:hover .react-flow__edge-path {
          stroke: #007bff;
          stroke-width: 3px;
        }
        
        .react-flow__edge.selected .react-flow__edge-path {
          stroke: #007bff;
          stroke-width: 4px;
        }
        
        .react-flow__nodes,
        .react-flow__edge-label {
          user-select: none;
          -webkit-user-select: none;
        }
        
        .react-flow__background-pattern {
          opacity: 0.6;
        }
      `}</style>
    </div>
  );
}

export default WorkflowViewer;