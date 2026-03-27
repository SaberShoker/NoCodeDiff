import { useState, useCallback, useEffect } from 'react';
import ReactFlow, { 
  useNodesState, 
  useEdgesState,
  Controls,
  Background,
  MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';

function WorkflowViewer() {
  const [jsonData, setJsonData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // 🔧 Настройки сетки привязки
  const SNAP_GRID_SIZE = 10; // Размер ячейки сетки (чем меньше, тем точнее)

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

  // 🔧 Функция округления координат до сетки
  const snapToGrid = useCallback((value) => {
    return Math.round(value / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
  }, []);

  const parseWorkflowData = useCallback((json) => {
    if (!json?.Scheme?.RouteScheme?.Layout) {
      return;
    }

    const routeScheme = json.Scheme.RouteScheme;
    const layout = routeScheme.Layout;
    const blocksCollection = routeScheme.Blocks?.$values || [];
    const edgesCollection = routeScheme.Edges?.$values || [];
    const blocksLayout = layout.BlocksLayout?.$values || [];

    // Парсим блоки из BlocksLayout с заголовками из Blocks
    const parsedNodes = blocksLayout.map(blockLayout => {
      const blockId = blockLayout.BlockId;
      const fullBlock = blocksCollection.find(b => b.Id === blockId);
      const blockType = getBlockType(fullBlock);
      
      return {
        id: blockId,
        position: { 
          x: snapToGrid(blockLayout.Bounds.X), // 🔧 Округляем начальные координаты
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

    // Парсим края из Edges
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

  // После загрузки данных — применяем fitView только один раз
  useEffect(() => {
    if (nodes.length > 0 && isInitialLoad) {
      const timer = setTimeout(() => {
        setIsInitialLoad(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, isInitialLoad]);

  // 🔧 Обработчик окончания перетаскивания с точной привязкой
  const onNodeDragStop = useCallback((event, node) => {
    const snappedPosition = {
      x: snapToGrid(node.position.x),
      y: snapToGrid(node.position.y)
    };

    console.log(`Блок ${node.id} перемещён:`, {
      от: node.position,
      до: snappedPosition
    });

    // 🔧 Принудительно устанавливаем позицию по сетке
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

  // Обработчик клика на узел — только выделение, без сдвига
  const onNodeClick = useCallback((event, node) => {
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
  }, [setNodes]);

  // Обработчик клика на край
  const onEdgeClick = useCallback((event, edge) => {
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
  }, [setEdges]);

  // Обработчик клика на пустое пространство
  const onPaneClick = useCallback(() => {
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
  }, [setNodes, setEdges]);

  // Вспомогательные функции
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
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: '#f5f5f5',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        <div style={{ 
          padding: '40px', 
          textAlign: 'center',
          border: '2px dashed #ccc',
          borderRadius: '12px',
          backgroundColor: 'white',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          maxWidth: '500px',
          width: '100%'
        }}>
          <h2 style={{ marginBottom: '20px', color: '#333' }}>
            Загрузите JSON файл со схемой маршрута (Sungero)
          </h2>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
            Файл должен содержать структуру: Scheme.RouteScheme с Blocks и Edges
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
            <p style={{ color: 'red', marginTop: '15px', fontSize: '14px' }}>{error}</p>
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
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{ 
          padding: '40px', 
          textAlign: 'center',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          maxWidth: '500px'
        }}>
          <p style={{ color: 'red', marginBottom: '20px' }}>Неверная структура JSON файла</p>
          <p style={{ color: '#666', marginBottom: '20px' }}>
            Ожидаемая структура: Scheme.RouteScheme.Layout с BlocksLayout и EdgesLayout
          </p>
          <button 
            onClick={handleReset} 
            style={{ 
              padding: '12px 24px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Загрузить другой файл
          </button>
        </div>
      </div>
    );
  }

  // Полноэкранное отображение схемы
  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: '#fff'
    }}>
      {/* Панель статистики */}
      <div style={{
        position: 'absolute',
        top: '15px',
        left: '15px',
        zIndex: 1000,
        backgroundColor: 'rgba(255,255,255,0.95)',
        padding: '12px 20px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: '14px',
        fontWeight: '500',
        pointerEvents: 'none'
      }}>
        <span style={{ marginRight: '15px' }}>
          <strong style={{ color: '#007bff' }}>{nodes.length}</strong> блоков
        </span>
        <span style={{ marginRight: '15px' }}>
          <strong style={{ color: '#28a745' }}>{edges.length}</strong> связей
        </span>
        {selectedNodeId && (
          <span style={{ color: '#dc3545' }}>
            <strong>Выбран блок:</strong> {selectedNodeId}
          </span>
        )}
        {selectedEdgeId && (
          <span style={{ color: '#28a745' }}>
            <strong>Выбрана связь:</strong> {selectedEdgeId.replace('edge-', '')}
          </span>
        )}
      </div>

      {/* 🔧 Панель настроек сетки */}
      <div style={{
        position: 'absolute',
        top: '15px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        backgroundColor: 'rgba(255,255,255,0.95)',
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: '13px',
        fontWeight: '500',
        pointerEvents: 'none'
      }}>
        📐 Шаг сетки: <strong style={{ color: '#007bff' }}>{SNAP_GRID_SIZE}px</strong>
      </div>

      {/* Кнопка сброса */}
      <button 
        onClick={handleReset}
        style={{
          position: 'absolute',
          top: '15px',
          right: '15px',
          zIndex: 1000,
          padding: '10px 20px',
          backgroundColor: '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '500',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          transition: 'background-color 0.2s',
          pointerEvents: 'auto'
        }}
        onMouseOver={(e) => e.target.style.backgroundColor = '#c82333'}
        onMouseOut={(e) => e.target.style.backgroundColor = '#dc3545'}
      >
        📁 Загрузить другой файл
      </button>

      {/* Панель информации о выбранном блоке */}
      {selectedNodeId && (
        <div style={{
          position: 'absolute',
          bottom: '15px',
          left: '15px',
          zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.95)',
          padding: '15px 20px',
          borderRadius: '8px',
          border: '1px solid #ddd',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          maxWidth: '400px',
          fontSize: '13px',
          pointerEvents: 'none'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#007bff' }}>
            📋 Информация о блоке
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>ID:</strong> {selectedNodeId}
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>Название:</strong> {
              nodes.find(n => n.id === selectedNodeId)?.data?.label || 'N/A'
            }
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>Тип:</strong> {
              nodes.find(n => n.id === selectedNodeId)?.data?.blockType || 'unknown'
            }
          </div>
          <div style={{ marginBottom: '4px', color: '#666' }}>
            <strong>Позиция (X, Y):</strong> {
              Math.round(nodes.find(n => n.id === selectedNodeId)?.position?.x) || 0}, {
              Math.round(nodes.find(n => n.id === selectedNodeId)?.position?.y) || 0}
          </div>
          <div style={{ marginBottom: '4px', color: '#28a745', fontSize: '11px' }}>
            ✅ Привязка к сетке: {SNAP_GRID_SIZE}px
          </div>
          <div style={{ color: '#666', fontSize: '11px', marginTop: '8px' }}>
            💡 Перетащите блок для изменения позиции • Клик для выбора
          </div>
        </div>
      )}

      {/* Панель информации о выбранной связи */}
      {selectedEdgeId && (
        <div style={{
          position: 'absolute',
          bottom: '15px',
          left: '15px',
          zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.95)',
          padding: '15px 20px',
          borderRadius: '8px',
          border: '1px solid #ddd',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          maxWidth: '400px',
          fontSize: '13px',
          pointerEvents: 'none'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#28a745' }}>
            🔗 Информация о связи
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>ID:</strong> {selectedEdgeId.replace('edge-', '')}
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>От:</strong> {
              edges.find(e => e.id === selectedEdgeId)?.source || 'N/A'
            }
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>К:</strong> {
              edges.find(e => e.id === selectedEdgeId)?.target || 'N/A'
            }
          </div>
          <div style={{ marginBottom: '4px' }}>
            <strong>Значение:</strong> {
              edges.find(e => e.id === selectedEdgeId)?.data?.edgeValue || 'N/A'
            }
          </div>
          <div style={{ color: '#666', fontSize: '11px', marginTop: '8px' }}>
            💡 Кликните на пустое место для снятия выделения
          </div>
        </div>
      )}

      {/* ReactFlow на весь экран */}
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
        snapGrid={[SNAP_GRID_SIZE, SNAP_GRID_SIZE]} // 🔧 Точная привязка к сетке
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
        <Background 
          color="#ccc" 
          gap={SNAP_GRID_SIZE} // 🔧 Визуальная сетка совпадает с привязкой
          size={1}
        />
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
            border: '1px solid #ddd'
          }}
        />
      </ReactFlow>

      {/* CSS стили для узлов и краёв */}
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
        
        /* Отключаем выделение текста при перетаскивании */
        .react-flow__nodes,
        .react-flow__edge-label {
          user-select: none;
          -webkit-user-select: none;
        }
        
        /* 🔧 Усиливаем видимость сетки */
        .react-flow__background-pattern {
          opacity: 0.6;
        }
      `}</style>
    </div>
  );
}

export default WorkflowViewer;