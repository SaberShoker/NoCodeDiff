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
  
  // 🔧 Храним полную коллекцию блоков из JSON для получения детальной информации
  const [blocksCollection, setBlocksCollection] = useState([]);
  
  // 🔧 Активная вкладка в панели информации
  const [activeInfoTab, setActiveInfoTab] = useState('general');

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
    setBlocksCollection([]);
    setIsInitialLoad(true);
    setActiveInfoTab('general');
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

    // 🔧 Сохраняем полную коллекцию блоков для последующего использования
    setBlocksCollection(blocksCollection);

    // Парсим блоки из BlocksLayout с заголовками из Blocks
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
          blockType: blockType,
          fullBlock: fullBlock // 🔧 Сохраняем полную информацию о блоке
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

  useEffect(() => {
    if (nodes.length > 0 && isInitialLoad) {
      const timer = setTimeout(() => {
        setIsInitialLoad(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, isInitialLoad]);

  // Обработчик окончания перетаскивания
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

  // 🔧 Получаем детальную информацию о блоке из сохранённой коллекции
  const getBlockDetails = useCallback((blockId) => {
    const block = blocksCollection.find(b => b.Id === blockId);
    if (!block) return null;
    
    return {
      // Основная информация
      id: block.Id,
      title: block.Title || 'Без названия',
      type: getBlockTypeName(block.$type),
      typeId: block.BlockTypeId,
      versionId: block.VersionId,
      description: block.Description || 'Нет описания',
      createdInTaskGuid: block.CreatedInTaskGuid,
      processStagesDisplayMode: block.ProcessStagesDisplayMode,
      timeoutErrorsCount: block.TimeoutErrorsCount,
      
      // 🔧 GroupsAttachmentsRights
      groupsAttachmentsRights: block.GroupsAttachmentsRights?.$values || [],
      
      // 🔧 AttachmentGroupsSettings
      attachmentGroupsSettings: block.AttachmentGroupsSettings?.$values || [],
      
      // 🔧 PropertyExpressions
      propertyExpressions: block.PropertyExpressions?.$values || [],
      
      // 🔧 ParameterOperations
      parameterOperations: block.ParameterOperations?.$values || [],
      
      // 🔧 Operations
      operations: block.Operations?.$values || [],
      
      // Специфичные поля для разных типов блоков
      executionResults: block.ExecutionResults?.$values || [],
      customExecutionResults: block.CustomExecutionResults?.$values || [],
      stopResults: block.StopResults?.$values || [],
      deadline: block.AbsoluteDeadline || block.RelativeDeadline || 'Не установлен',
      isParallel: block.IsParallel || false,
      isCompetitive: block.IsCompetitive || false,
      isStopped: block.IsStopped || false,
      isWithAbsences: block.IsWithAbsences || false,
      hasStopDeadline: block.HasStopDeadline || false,
      performers: block.SidsOfPerformers?.$values?.length || 0,
      resultVariableName: block.ResultVariableName,
      result: block.Result,
      noPerformersResult: block.NoPerformersResult,
      instruction: block.Instruction,
      subject: block.Subject,
      threadSubject: block.ThreadSubject,
      typeName: block.TypeName,
      typeGuid: block.TypeGuid,
      author: block.Author,
      text: block.Text,
      
      // Для AssignmentBlock
      relativeDeadlineDays: block.RelativeDeadlineDays,
      relativeDeadlineHours: block.RelativeDeadlineHours,
      absoluteDeadlineInternal: block.AbsoluteDeadlineInternal,
      stopResults: block.StopResults,
      
      // Для ScriptBlock
      customTypeProperties: block.CustomTypeProperties?.$values || [],
      
      // Для DecisionBlock
      conditionExpressions: block.ConditionExpressions?.$values || [],
      
      // Для NoticeBlock
      sidsOfPerformers: block.SidsOfPerformers?.$values || [],
      
      // Для WaitingBlock
      relativeDeadline: block.RelativeDeadline,
      deadlineInternal: block.DeadlineInternal
    };
  }, [blocksCollection]);

  // Обработчик клика на узел
  const onNodeClick = useCallback((event, node) => {
    onActivate(areaId);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setActiveInfoTab('general'); // Сбрасываем на первую вкладку
    
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

  // Обработчик клика на край
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

  // Обработчик клика на пустое пространство
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

  function getBlockTypeName(typeString) {
    if (!typeString) return 'Неизвестный тип';
    const parts = typeString.split('.');
    return parts[parts.length - 1] || typeString;
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

  // 🔧 Получаем текущий выбранный блок
  const selectedBlockDetails = selectedNodeId ? getBlockDetails(selectedNodeId) : null;

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

  // 🔧 Вкладки для панели информации
  const infoTabs = [
    { id: 'general', label: '📋 Основное', count: null },
    { id: 'rights', label: '🔐 Права', count: selectedBlockDetails?.groupsAttachmentsRights?.length || 0 },
    { id: 'attachments', label: '📎 Вложения', count: selectedBlockDetails?.attachmentGroupsSettings?.length || 0 },
    { id: 'properties', label: '⚙️ Свойства', count: selectedBlockDetails?.propertyExpressions?.length || 0 },
    { id: 'parameters', label: '📊 Параметры', count: selectedBlockDetails?.parameterOperations?.length || 0 },
    { id: 'operations', label: '🔧 Операции', count: selectedBlockDetails?.operations?.length || 0 }
  ];

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

      {/* 🔧 Панель детальной информации о блоке с вкладками */}
      {selectedBlockDetails && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.98)',
          borderRadius: '8px',
          border: '2px solid #007bff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: '500px',
          maxHeight: '500px',
          overflow: 'hidden',
          fontSize: '12px',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Заголовок панели с кнопкой закрытия */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            padding: '12px 15px',
            borderBottom: '2px solid #007bff',
            backgroundColor: '#f8f9fa'
          }}>
            <h4 style={{ margin: 0, color: '#007bff', fontSize: '14px' }}>
              📋 {selectedBlockDetails.title || 'Блок'}
            </h4>
            <button 
              onClick={() => setSelectedNodeId(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#666',
                padding: '0 4px',
                lineHeight: 1
              }}
            >
              ✕
            </button>
          </div>

          {/* Вкладки */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #ddd',
            backgroundColor: '#fff',
            overflowX: 'auto'
          }}>
            {infoTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveInfoTab(tab.id)}
                style={{
                  padding: '8px 12px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: activeInfoTab === tab.id ? '600' : '400',
                  color: activeInfoTab === tab.id ? '#007bff' : '#666',
                  borderBottom: activeInfoTab === tab.id ? '2px solid #007bff' : '2px solid transparent',
                  whiteSpace: 'nowrap',
                  position: 'relative',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  if (activeInfoTab !== tab.id) {
                    e.target.style.backgroundColor = '#f0f0f0';
                  }
                }}
                onMouseOut={(e) => {
                  if (activeInfoTab !== tab.id) {
                    e.target.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {tab.label}
                {tab.count !== null && tab.count > 0 && (
                  <span style={{
                    marginLeft: '4px',
                    padding: '1px 4px',
                    backgroundColor: activeInfoTab === tab.id ? '#007bff' : '#e0e0e0',
                    color: activeInfoTab === tab.id ? '#fff' : '#666',
                    borderRadius: '10px',
                    fontSize: '10px'
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Содержимое вкладок */}
          <div style={{
            padding: '15px',
            overflowY: 'auto',
            flex: 1,
            maxHeight: '350px'
          }}>
            {/* 🔧 Вкладка: Основное */}
            {activeInfoTab === 'general' && (
              <div>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ marginBottom: '6px' }}>
                    <strong style={{ color: '#333' }}>ID:</strong>{' '}
                    <span style={{ color: '#007bff', fontFamily: 'monospace', fontSize: '11px' }}>
                      {selectedBlockDetails.id}
                    </span>
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    <strong style={{ color: '#333' }}>Тип:</strong>{' '}
                    <span style={{ 
                      color: '#fff', 
                      backgroundColor: '#007bff', 
                      padding: '2px 6px', 
                      borderRadius: '4px',
                      fontSize: '10px'
                    }}>
                      {selectedBlockDetails.type}
                    </span>
                  </div>
                  {selectedBlockDetails.description && selectedBlockDetails.description !== 'Нет описания' && (
                    <div style={{ 
                      marginBottom: '6px', 
                      padding: '6px', 
                      backgroundColor: '#f8f9fa', 
                      borderRadius: '4px',
                      borderLeft: '3px solid #007bff'
                    }}>
                      <strong style={{ color: '#333' }}>Описание:</strong>{' '}
                      <span style={{ color: '#555' }}>{selectedBlockDetails.description}</span>
                    </div>
                  )}
                  <div style={{ marginBottom: '6px', fontSize: '10px', color: '#666' }}>
                    <strong>BlockTypeId:</strong>{' '}
                    <span style={{ fontFamily: 'monospace' }}>{selectedBlockDetails.typeId?.substring(0, 36)}...</span>
                  </div>
                  <div style={{ marginBottom: '6px', fontSize: '10px', color: '#666' }}>
                    <strong>VersionId:</strong>{' '}
                    <span style={{ fontFamily: 'monospace' }}>{selectedBlockDetails.versionId?.substring(0, 36)}...</span>
                  </div>
                </div>

                {/* Специфичная информация */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr', 
                  gap: '8px',
                  marginBottom: '12px'
                }}>
                  {selectedBlockDetails.isParallel !== undefined && (
                    <div style={{ padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                      <strong style={{ color: '#333', fontSize: '10px' }}>Параллельный:</strong>
                      <div style={{ color: selectedBlockDetails.isParallel ? '#28a745' : '#666' }}>
                        {selectedBlockDetails.isParallel ? '✓ Да' : '✗ Нет'}
                      </div>
                    </div>
                  )}
                  {selectedBlockDetails.isCompetitive !== undefined && (
                    <div style={{ padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                      <strong style={{ color: '#333', fontSize: '10px' }}>Конкурентный:</strong>
                      <div style={{ color: selectedBlockDetails.isCompetitive ? '#28a745' : '#666' }}>
                        {selectedBlockDetails.isCompetitive ? '✓ Да' : '✗ Нет'}
                      </div>
                    </div>
                  )}
                  {selectedBlockDetails.performers !== undefined && (
                    <div style={{ padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                      <strong style={{ color: '#333', fontSize: '10px' }}>Исполнители:</strong>
                      <div style={{ color: '#007bff' }}>{selectedBlockDetails.performers}</div>
                    </div>
                  )}
                  {selectedBlockDetails.operations?.length !== undefined && (
                    <div style={{ padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                      <strong style={{ color: '#333', fontSize: '10px' }}>Операций:</strong>
                      <div style={{ color: '#6f42c1' }}>{selectedBlockDetails.operations.length}</div>
                    </div>
                  )}
                </div>

                {/* Результаты выполнения */}
                {selectedBlockDetails.executionResults?.length > 0 && (
                  <div style={{ 
                    marginBottom: '12px', 
                    padding: '8px', 
                    backgroundColor: '#e8f4fd', 
                    borderRadius: '4px'
                  }}>
                    <strong style={{ color: '#007bff', fontSize: '11px' }}>Результаты выполнения:</strong>
                    <div style={{ marginTop: '4px' }}>
                      {selectedBlockDetails.executionResults.map((result, idx) => (
                        <span 
                          key={idx}
                          style={{ 
                            display: 'inline-block',
                            margin: '2px',
                            padding: '2px 6px',
                            backgroundColor: '#007bff',
                            color: 'white',
                            borderRadius: '3px',
                            fontSize: '9px'
                          }}
                        >
                          {result}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Кастомные свойства */}
                {selectedBlockDetails.customTypeProperties?.length > 0 && (
                  <div style={{ 
                    padding: '8px', 
                    backgroundColor: '#fff3cd', 
                    borderRadius: '4px',
                    border: '1px solid #ffc107'
                  }}>
                    <strong style={{ color: '#856404', fontSize: '11px' }}>⚙️ Свойства:</strong>
                    <div style={{ marginTop: '4px' }}>
                      {selectedBlockDetails.customTypeProperties.map((prop, idx) => (
                        <div 
                          key={idx}
                          style={{ 
                            fontSize: '10px', 
                            marginBottom: '2px',
                            padding: '2px 4px',
                            backgroundColor: 'rgba(255,255,255,0.5)',
                            borderRadius: '2px'
                          }}
                        >
                          <strong>{prop.Name}:</strong> {String(prop.Value)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 🔧 Вкладка: Права доступа (GroupsAttachmentsRights) */}
            {activeInfoTab === 'rights' && (
              <div>
                <h5 style={{ margin: '0 0 10px 0', color: '#007bff', fontSize: '12px' }}>
                  🔐 Права доступа к вложениям
                </h5>
                {selectedBlockDetails.groupsAttachmentsRights?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedBlockDetails.groupsAttachmentsRights.map((right, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          padding: '8px', 
                          backgroundColor: '#f8f9fa', 
                          borderRadius: '4px',
                          border: '1px solid #e0e0e0'
                        }}
                      >
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Group ID:</strong>{' '}
                          <span style={{ fontFamily: 'monospace', color: '#007bff' }}>
                            {right.GroupId?.substring(0, 36)}...
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Права:</strong>{' '}
                          <span style={{ color: '#28a745' }}>{right.AttachmentsRights}</span>
                        </div>
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Тип прав:</strong>{' '}
                          <span style={{ fontFamily: 'monospace' }}>{right.AttachmentsRightsTypeString?.substring(0, 36)}...</span>
                        </div>
                        <div style={{ fontSize: '10px' }}>
                          <strong>Не выше инициатора:</strong>{' '}
                          <span style={{ color: right.IsNotGreaterInitiatorRights ? '#dc3545' : '#28a745' }}>
                            {right.IsNotGreaterInitiatorRights ? 'Да' : 'Нет'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#999', fontSize: '11px', textAlign: 'center', padding: '20px' }}>
                    Нет прав доступа
                  </p>
                )}
              </div>
            )}

            {/* 🔧 Вкладка: Вложения (AttachmentGroupsSettings) */}
            {activeInfoTab === 'attachments' && (
              <div>
                <h5 style={{ margin: '0 0 10px 0', color: '#007bff', fontSize: '12px' }}>
                  📎 Настройки групп вложений
                </h5>
                {selectedBlockDetails.attachmentGroupsSettings?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedBlockDetails.attachmentGroupsSettings.map((setting, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          padding: '8px', 
                          backgroundColor: '#f8f9fa', 
                          borderRadius: '4px',
                          border: '1px solid #e0e0e0'
                        }}
                      >
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Group ID:</strong>{' '}
                          <span style={{ fontFamily: 'monospace', color: '#007bff' }}>
                            {setting.GroupId?.substring(0, 36)}...
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Скрыта:</strong>{' '}
                          <span style={{ color: setting.IsHidden ? '#dc3545' : '#28a745' }}>
                            {setting.IsHidden ? 'Да' : 'Нет'}
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Включена:</strong>{' '}
                          <span style={{ color: setting.IsEnabled ? '#28a745' : '#999' }}>
                            {setting.IsEnabled ? 'Да' : 'Нет'}
                          </span>
                        </div>
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Обязательна:</strong>{' '}
                          <span style={{ color: setting.IsRequired ? '#28a745' : '#999' }}>
                            {setting.IsRequired ? 'Да' : 'Нет'}
                          </span>
                        </div>
                        <div style={{ fontSize: '10px' }}>
                          <strong>Родительская группа:</strong>{' '}
                          <span style={{ color: setting.IsParentTaskGroup ? '#28a745' : '#999' }}>
                            {setting.IsParentTaskGroup ? 'Да' : 'Нет'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#999', fontSize: '11px', textAlign: 'center', padding: '20px' }}>
                    Нет настроек вложений
                  </p>
                )}
              </div>
            )}

            {/* 🔧 Вкладка: Свойства (PropertyExpressions) */}
            {activeInfoTab === 'properties' && (
              <div>
                <h5 style={{ margin: '0 0 10px 0', color: '#007bff', fontSize: '12px' }}>
                  ⚙️ Выражения свойств
                </h5>
                {selectedBlockDetails.propertyExpressions?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedBlockDetails.propertyExpressions.map((expr, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          padding: '8px', 
                          backgroundColor: '#f8f9fa', 
                          borderRadius: '4px',
                          border: '1px solid #e0e0e0'
                        }}
                      >
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Свойство:</strong>{' '}
                          <span style={{ color: '#007bff', fontWeight: '600' }}>{expr.PropertyName}</span>
                        </div>
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Property ID:</strong>{' '}
                          <span style={{ fontFamily: 'monospace', color: '#666' }}>
                            {expr.PropertyId?.substring(0, 36)}...
                          </span>
                        </div>
                        {expr.Expression?.Description && (
                          <div style={{ fontSize: '10px', color: '#555' }}>
                            <strong>Описание:</strong> {expr.Expression.Description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#999', fontSize: '11px', textAlign: 'center', padding: '20px' }}>
                    Нет выражений свойств
                  </p>
                )}
              </div>
            )}

            {/* 🔧 Вкладка: Параметры (ParameterOperations) */}
            {activeInfoTab === 'parameters' && (
              <div>
                <h5 style={{ margin: '0 0 10px 0', color: '#007bff', fontSize: '12px' }}>
                  📊 Операции с параметрами
                </h5>
                {selectedBlockDetails.parameterOperations?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedBlockDetails.parameterOperations.map((op, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          padding: '8px', 
                          backgroundColor: '#f8f9fa', 
                          borderRadius: '4px',
                          border: '1px solid #e0e0e0'
                        }}
                      >
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Тип:</strong>{' '}
                          <span style={{ 
                            color: '#fff', 
                            backgroundColor: '#6f42c1', 
                            padding: '1px 4px', 
                            borderRadius: '3px',
                            fontSize: '9px'
                          }}>
                            {op.$type?.split('.').pop() || 'Operation'}
                          </span>
                        </div>
                        {op.ExecutionResultCode && (
                          <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                            <strong>Результат:</strong>{' '}
                            <span style={{ color: '#007bff' }}>{op.ExecutionResultCode}</span>
                          </div>
                        )}
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Параметр:</strong>{' '}
                          <span style={{ fontFamily: 'monospace', color: '#666' }}>
                            {op.ParameterUuid?.substring(0, 36)}...
                          </span>
                        </div>
                        <div style={{ fontSize: '10px' }}>
                          <strong>Операция:</strong>{' '}
                          <span style={{ color: '#28a745' }}>{op.OperationType}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#999', fontSize: '11px', textAlign: 'center', padding: '20px' }}>
                    Нет операций с параметрами
                  </p>
                )}
              </div>
            )}

            {/* 🔧 Вкладка: Операции (Operations) */}
            {activeInfoTab === 'operations' && (
              <div>
                <h5 style={{ margin: '0 0 10px 0', color: '#007bff', fontSize: '12px' }}>
                  🔧 Операции блока
                </h5>
                {selectedBlockDetails.operations?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedBlockDetails.operations.map((op, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          padding: '8px', 
                          backgroundColor: '#f8f9fa', 
                          borderRadius: '4px',
                          border: '1px solid #e0e0e0'
                        }}
                      >
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Тип:</strong>{' '}
                          <span style={{ 
                            color: '#fff', 
                            backgroundColor: '#fd7e14', 
                            padding: '1px 4px', 
                            borderRadius: '3px',
                            fontSize: '9px'
                          }}>
                            {op.$type?.split('.').pop() || 'Operation'}
                          </span>
                        </div>
                        {op.ExecutionResult && (
                          <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                            <strong>Результат:</strong>{' '}
                            <span style={{ color: '#007bff' }}>{op.ExecutionResult}</span>
                          </div>
                        )}
                        <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                          <strong>Операция:</strong>{' '}
                          <span style={{ color: '#28a745' }}>{op.OperationType}</span>
                        </div>
                        {op.DestinationProperty?.Description && (
                          <div style={{ fontSize: '10px', color: '#555' }}>
                            <strong>Цель:</strong> {op.DestinationProperty.Description}
                          </div>
                        )}
                        {op.Value?.Description && (
                          <div style={{ fontSize: '10px', color: '#555' }}>
                            <strong>Значение:</strong> {op.Value.Description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#999', fontSize: '11px', textAlign: 'center', padding: '20px' }}>
                    Нет операций
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Подсказка */}
          <div style={{ 
            padding: '8px 15px', 
            borderTop: '1px dashed #ddd',
            fontSize: '10px',
            color: '#999',
            textAlign: 'center',
            backgroundColor: '#f8f9fa'
          }}>
            💡 Кликните на пустое место для закрытия
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