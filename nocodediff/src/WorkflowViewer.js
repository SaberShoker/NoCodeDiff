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
  onActivate,
  onCompare,
  sharedGitConfig,
  setSharedGitConfig,
  sharedGitFiles,
  setSharedGitFiles,
  sharedSelectedGitFile,
  setSharedSelectedGitFile,
  sharedGitCommits,
  setSharedGitCommits
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
  
  // 🔧 Git состояние - используем синхронизированное из родителя
  const gitConfig = sharedGitConfig;
  const setGitConfig = setSharedGitConfig;
  const gitFiles = sharedGitFiles;
  const setGitFiles = setSharedGitFiles;
  const selectedGitFile = sharedSelectedGitFile;
  const setSelectedGitFile = setSharedSelectedGitFile;
  const gitCommits = sharedGitCommits;
  const setGitCommits = setSharedGitCommits;
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareData, setCompareData] = useState({ old: null, new: null });
  const [isLoadingGit, setIsLoadingGit] = useState(false);

  // Функция округления координат до сетки
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

    setBlocksCollection(blocksCollection);

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
            fullBlock: fullBlock
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

  // 🔧 Рекурсивная загрузка файлов из Git
  const loadGitFilesRecursive = useCallback(async (owner, repo, path = '', branch) => {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents${path ? '/' + path : ''}?ref=${branch}`,
      {
        headers: {
          'Authorization': `token ${gitConfig.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'WorkflowViewer-App/1.0'
        }
      }
    );

    if (!response.ok) {
      return [];
    }

    const items = await response.json();
    let jsonFiles = [];

    for (const item of items) {
      if (item.type === 'dir') {
        // Рекурсивно загружаем содержимое папки
        const subFolderFiles = await loadGitFilesRecursive(owner, repo, item.path, branch);
        jsonFiles = jsonFiles.concat(subFolderFiles);
      } else if (item.name.endsWith('.json')) {
        jsonFiles.push(item);
      }
    }

    return jsonFiles;
  }, [gitConfig]);

  // 🔧 Загрузка файлов из Git
  const loadGitFiles = useCallback(async () => {
    console.log('🔍 Загрузка файлов из Git...', gitConfig);
    
    if (!gitConfig.repository || !gitConfig.token) {
      const errorMsg = !gitConfig.repository 
        ? '❌ Укажите репозиторий (формат: owner/repo)' 
        : '❌ Укажите токен доступа GitHub';
      setError(errorMsg);
      console.error(errorMsg);
      return;
    }

    setIsLoadingGit(true);
    setError(null);
    
    try {
      const [owner, repo] = gitConfig.repository.split('/');
      
      if (!owner || !repo) {
        throw new Error('Неверный формат репозитория. Используйте: owner/repo');
      }
      
      console.log(`📡 Запрос к GitHub API: ${owner}/${repo}@${gitConfig.branch}`);
      
      // 🔧 Рекурсивная загрузка всех JSON файлов из репозитория
      const jsonFiles = await loadGitFilesRecursive(owner, repo, '', gitConfig.branch);
      
      console.log('✅ Найдено JSON файлов:', jsonFiles.length);
      setGitFiles(jsonFiles);
      
      if (jsonFiles.length === 0) {
        setError('⚠️ JSON файлы не найдены в репозитории');
      }
    } catch (err) {
      console.error('❌ Ошибка загрузки:', err);
      setError('Ошибка загрузки из Git: ' + err.message);
    } finally {
      setIsLoadingGit(false);
    }
  }, [gitConfig, setGitFiles, loadGitFilesRecursive]);

  // 🔧 Загрузка содержимого файла из Git
  const loadGitFileContent = useCallback(async (file) => {
    setIsLoadingGit(true);
    try {
      const response = await fetch(file.download_url);
      const json = await response.json();
      setJsonData(json);
      setSelectedGitFile(file);
      setError(null);
      parseWorkflowData(json);
    } catch (err) {
      setError('Ошибка загрузки файла: ' + err.message);
    } finally {
      setIsLoadingGit(false);
    }
  }, [setSelectedGitFile, parseWorkflowData]);

  // 🔧 Загрузка коммитов для сравнения
  const loadGitCommits = useCallback(async () => {
    if (!gitConfig.repository || !gitConfig.token || !selectedGitFile) {
      setError('Выберите файл из репозитория');
      return;
    }

    setIsLoadingGit(true);
    try {
      const [owner, repo] = gitConfig.repository.split('/');
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?path=${selectedGitFile.path}&sha=${gitConfig.branch}`,
        {
          headers: {
            'Authorization': `token ${gitConfig.token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const commits = await response.json();
      setGitCommits(commits.slice(0, 10));
    } catch (err) {
      setError('Ошибка загрузки коммитов: ' + err.message);
    } finally {
      setIsLoadingGit(false);
    }
  }, [gitConfig, selectedGitFile, setGitCommits]);

  // 🔧 Загрузка версии файла по коммиту
  const loadCommitVersion = useCallback(async (commit, versionType) => {
    setIsLoadingGit(true);
    try {
      const [owner, repo] = gitConfig.repository.split('/');
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${selectedGitFile.path}?ref=${commit.sha}`,
        {
          headers: {
            'Authorization': `token ${gitConfig.token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const fileData = await response.json();
      
      if (!fileData.content) {
        throw new Error('Файл не содержит данных');
      }
      
      const content = atob(fileData.content);
      
      if (!content || content.trim() === '') {
        throw new Error('Пустое содержимое файла');
      }
      
      let json;
      try {
        json = JSON.parse(content);
      } catch (parseErr) {
        throw new Error('Ошибка парсинга JSON: ' + parseErr.message);
      }

      setCompareData(prev => ({
        ...prev,
        [versionType]: { commit, json }
      }));
    } catch (err) {
      setError('Ошибка загрузки версии: ' + err.message);
    } finally {
      setIsLoadingGit(false);
    }
  }, [gitConfig, selectedGitFile, setCompareData]);

  // 🔧 Выполнение сравнения двух версий
  const executeCompare = useCallback(() => {
    if (compareData.old && compareData.new) {
      setCompareMode(true);
      onCompare({
        old: compareData.old.json,
        new: compareData.new.json,
        oldCommit: compareData.old.commit,
        newCommit: compareData.new.commit
      });
    }
  }, [compareData, onCompare]);

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
    setCompareMode(false);
    setCompareData({ old: null, new: null });
  };

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

  const getBlockDetails = useCallback((blockId) => {
    const block = blocksCollection.find(b => b.Id === blockId);
    if (!block) return null;
    
    return {
      id: block.Id,
      title: block.Title || 'Без названия',
      type: getBlockTypeName(block.$type),
      typeId: block.BlockTypeId,
      versionId: block.VersionId,
      description: block.Description || 'Нет описания',
      groupsAttachmentsRights: block.GroupsAttachmentsRights?.$values || [],
      attachmentGroupsSettings: block.AttachmentGroupsSettings?.$values || [],
      propertyExpressions: block.PropertyExpressions?.$values || [],
      parameterOperations: block.ParameterOperations?.$values || [],
      operations: block.Operations?.$values || [],
      executionResults: block.ExecutionResults?.$values || [],
      customExecutionResults: block.CustomExecutionResults?.$values || [],
      deadline: block.AbsoluteDeadline || block.RelativeDeadline || 'Не установлен',
      isParallel: block.IsParallel || false,
      isCompetitive: block.IsCompetitive || false,
      performers: block.SidsOfPerformers?.$values?.length || 0,
      customTypeProperties: block.CustomTypeProperties?.$values || []
    };
  }, [blocksCollection]);

  const onNodeClick = useCallback((event, node) => {
    onActivate(areaId);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setActiveInfoTab('general');
    
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

  const selectedBlockDetails = selectedNodeId ? getBlockDetails(selectedNodeId) : null;

  const infoTabs = [
    { id: 'general', label: '📋 Основное', count: null },
    { id: 'rights', label: '🔐 Права', count: selectedBlockDetails?.groupsAttachmentsRights?.length || 0 },
    { id: 'attachments', label: '📎 Вложения', count: selectedBlockDetails?.attachmentGroupsSettings?.length || 0 },
    { id: 'properties', label: '⚙️ Свойства', count: selectedBlockDetails?.propertyExpressions?.length || 0 },
    { id: 'parameters', label: '📊 Параметры', count: selectedBlockDetails?.parameterOperations?.length || 0 },
    { id: 'operations', label: '🔧 Операции', count: selectedBlockDetails?.operations?.length || 0 }
  ];

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
          border: '2px dashed #ccc',
          borderRadius: '12px',
          backgroundColor: 'white',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          maxWidth: '500px',
          width: '100%'
        }}>
          <h3 style={{ marginBottom: '15px', color: '#333' }}>
            {title}
          </h3>
          
          <div style={{ marginBottom: '20px' }}>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '15px' }}>
              Загрузите JSON файл со схемой маршрута
            </p>
            
            <input 
              type="file" 
              accept=".json" 
              onChange={handleFileUpload}
              style={{ 
                margin: '10px 0',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                width: '100%',
                boxSizing: 'border-box'
              }}
            />
            
            <div style={{ 
              marginTop: '20px', 
              padding: '15px', 
              backgroundColor: '#f8f9fa', 
              borderRadius: '8px',
              border: '1px solid #ddd'
            }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#333', fontSize: '14px' }}>
                📦 Загрузка из Git
              </h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <input 
                  type="text" 
                  placeholder="owner/repo" 
                  value={gitConfig.repository}
                  onChange={(e) => setGitConfig(prev => ({ ...prev, repository: e.target.value }))}
                  style={{ 
                    padding: '8px', 
                    border: '1px solid #ddd', 
                    borderRadius: '4px',
                    fontSize: '13px'
                  }}
                />
                <input 
                  type="text" 
                  placeholder="branch (main)" 
                  value={gitConfig.branch}
                  onChange={(e) => setGitConfig(prev => ({ ...prev, branch: e.target.value }))}
                  style={{ 
                    padding: '8px', 
                    border: '1px solid #ddd', 
                    borderRadius: '4px',
                    fontSize: '13px'
                  }}
                />
              </div>
              
              <input 
                type="password" 
                placeholder="GitHub Token" 
                value={gitConfig.token}
                onChange={(e) => setGitConfig(prev => ({ ...prev, token: e.target.value }))}
                style={{ 
                  padding: '8px', 
                  border: '1px solid #ddd', 
                  borderRadius: '4px',
                  width: '100%',
                  boxSizing: 'border-box',
                  marginBottom: '10px',
                  fontSize: '13px'
                }}
              />
              
              <button 
                onClick={() => {
                  console.log('🖱️ Клик по кнопке загрузки');
                  loadGitFiles();
                }}
                disabled={isLoadingGit}
                style={{ 
                  padding: '8px 16px', 
                  backgroundColor: '#28a745', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px',
                  cursor: isLoadingGit ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  opacity: isLoadingGit ? 0.7 : 1,
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  if (!isLoadingGit) e.target.style.backgroundColor = '#218838';
                }}
                onMouseOut={(e) => {
                  if (!isLoadingGit) e.target.style.backgroundColor = '#28a745';
                }}
              >
                {isLoadingGit ? '⏳ Загрузка...' : '📂 Загрузить файлы'}
              </button>
              {error && gitConfig.repository && gitConfig.token && (
                <p style={{ 
                  color: '#dc3545', 
                  marginTop: '10px', 
                  fontSize: '12px',
                  padding: '8px',
                  backgroundColor: '#f8d7da',
                  borderRadius: '4px',
                  border: '1px solid #f5c6cb'
                }}>
                  ⚠️ {error}
                </p>
              )}
              {gitFiles.length > 0 && (
                <div style={{ 
                  marginTop: '15px', 
                  maxHeight: '200px', 
                  overflowY: 'auto',
                  border: '1px solid #ddd',
                  borderRadius: '4px'
                }}>
                  {gitFiles.map(file => (
                    <div 
                      key={file.path}
                      onClick={() => setSelectedGitFile(file)}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid #eee',
                        cursor: 'pointer',
                        backgroundColor: selectedGitFile?.path === file.path ? '#e3f2fd' : 'white',
                        fontSize: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <span>📄 {file.path}</span>
                      {selectedGitFile?.path === file.path && (
                        <span style={{ color: '#28a745', fontSize: '11px' }}>✓ Выбран</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {selectedGitFile && (
                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #ddd' }}>
                  <button 
                    onClick={() => loadGitFileContent(selectedGitFile)}
                    disabled={isLoadingGit}
                    style={{ 
                      padding: '8px 16px', 
                      backgroundColor: '#28a745', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '4px',
                      cursor: isLoadingGit ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      marginRight: '10px'
                    }}
                  >
                    📂 Открыть файл
                  </button>
                  <button 
                    onClick={loadGitCommits}
                    disabled={isLoadingGit}
                    style={{ 
                      padding: '8px 16px', 
                      backgroundColor: '#17a2b8', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '4px',
                      cursor: isLoadingGit ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      marginRight: '10px'
                    }}
                  >
                    📜 История коммитов
                  </button>
                  
                  {compareData.old && compareData.new && (
                    <button 
                      onClick={executeCompare}
                      style={{ 
                        padding: '8px 16px', 
                        backgroundColor: '#6f42c1', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      🔍 Сравнить версии
                    </button>
                  )}
                </div>
              )}
              
              {gitCommits.length > 0 && (
                <div style={{ 
                  marginTop: '15px',
                  padding: '10px',
                  backgroundColor: '#fff3cd',
                  borderRadius: '4px',
                  border: '1px solid #ffc107'
                }}>
                  <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#856404' }}>
                    Выберите 2 версии для сравнения:
                  </h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <select 
                      onChange={(e) => {
                        const commit = gitCommits.find(c => c.sha === e.target.value);
                        if (commit) loadCommitVersion(commit, 'old');
                      }}
                      style={{ padding: '6px', fontSize: '12px', borderRadius: '4px' }}
                    >
                      <option value="">Старая версия</option>
                      {gitCommits.map(commit => (
                        <option key={commit.sha} value={commit.sha}>
                          {commit.sha.substring(0, 7)} - {commit.commit.message.substring(0, 30)}
                        </option>
                      ))}
                    </select>
                    
                    <select 
                      onChange={(e) => {
                        const commit = gitCommits.find(c => c.sha === e.target.value);
                        if (commit) loadCommitVersion(commit, 'new');
                      }}
                      style={{ padding: '6px', fontSize: '12px', borderRadius: '4px' }}
                    >
                      <option value="">Новая версия</option>
                      {gitCommits.map(commit => (
                        <option key={commit.sha} value={commit.sha}>
                          {commit.sha.substring(0, 7)} - {commit.commit.message.substring(0, 30)}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {compareData.old && compareData.new && (
                    <div style={{ 
                      marginTop: '10px', 
                      padding: '8px', 
                      backgroundColor: '#d4edda', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: '#155724'
                    }}>
                      ✓ Готово к сравнению: {compareData.old.commit.sha.substring(0, 7)} → {compareData.new.commit.sha.substring(0, 7)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {error && (
            <p style={{ color: 'red', marginTop: '15px', fontSize: '13px' }}>{error}</p>
          )}
        </div>
      </div>
    );
  }

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
        {selectedGitFile && (
          <span style={{ marginLeft: '15px', color: '#28a745', fontSize: '11px' }}>
            📦 {selectedGitFile.name}
          </span>
        )}
        {compareMode && (
          <span style={{ marginLeft: '15px', color: '#6f42c1', fontSize: '11px' }}>
            🔍 Режим сравнения
          </span>
        )}
        {selectedNodeId && (
          <span style={{ marginLeft: '15px', color: '#dc3545' }}>
            Выбран: {selectedNodeId}
          </span>
        )}
      </div>

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

          <div style={{
            padding: '15px',
            overflowY: 'auto',
            flex: 1,
            maxHeight: '350px'
          }}>
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
                </div>

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
                          <strong>Обязательна:</strong>{' '}
                          <span style={{ color: setting.IsRequired ? '#28a745' : '#999' }}>
                            {setting.IsRequired ? 'Да' : 'Нет'}
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
  const [compareData, setCompareData] = useState(null);
  const [showCompareView, setShowCompareView] = useState(false);
  
  // 🔧 Синхронизированное Git состояние между всеми окнами
  const [sharedGitConfig, setSharedGitConfig] = useState({
    provider: 'github',
    repository: '',
    branch: 'main',
    token: ''
  });
  const [sharedGitFiles, setSharedGitFiles] = useState([]);
  const [sharedSelectedGitFile, setSharedSelectedGitFile] = useState(null);
  const [sharedGitCommits, setSharedGitCommits] = useState([]);

  const addArea = () => {
    if (areas.length >= 2) return;
    const newId = Math.max(...areas.map(a => a.id)) + 1;
    setAreas([...areas, { id: newId, title: `Схема ${newId}`, active: false }]);
  };

  const removeArea = (id) => {
    if (areas.length <= 1) return;
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

  const handleCompare = useCallback((data) => {
    setCompareData(data);
    setShowCompareView(true);
  }, []);

  const CompareView = () => {
    if (!compareData) return null;

    const findDifferences = (oldJson, newJson) => {
      const differences = [];
      
      const oldBlocks = oldJson?.Scheme?.RouteScheme?.Blocks?.$values || [];
      const newBlocks = newJson?.Scheme?.RouteScheme?.Blocks?.$values || [];
      
      oldBlocks.forEach(oldBlock => {
        const newBlock = newBlocks.find(b => b.Id === oldBlock.Id);
        if (!newBlock) {
          differences.push({ type: 'removed', blockId: oldBlock.Id, block: oldBlock });
        } else {
          if (oldBlock.Title !== newBlock.Title) {
            differences.push({ 
              type: 'modified', 
              blockId: oldBlock.Id, 
              property: 'Title',
              oldValue: oldBlock.Title,
              newValue: newBlock.Title
            });
          }
          if (oldBlock.$type !== newBlock.$type) {
            differences.push({ 
              type: 'modified', 
              blockId: oldBlock.Id, 
              property: 'Type',
              oldValue: oldBlock.$type,
              newValue: newBlock.$type
            });
          }
        }
      });
      
      newBlocks.forEach(newBlock => {
        const oldBlock = oldBlocks.find(b => b.Id === newBlock.Id);
        if (!oldBlock) {
          differences.push({ type: 'added', blockId: newBlock.Id, block: newBlock });
        }
      });
      
      return differences;
    };

    const differences = findDifferences(compareData.old, compareData.new);

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '1200px',
          height: '80%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '20px',
            borderBottom: '2px solid #007bff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ margin: 0, color: '#333' }}>
              🔍 Сравнение версий схемы
            </h3>
            <button 
              onClick={() => setShowCompareView(false)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              ✕ Закрыть
            </button>
          </div>

          <div style={{
            padding: '15px 20px',
            backgroundColor: '#f8f9fa',
            borderBottom: '1px solid #ddd',
            display: 'flex',
            gap: '20px'
          }}>
            <div>
              <strong>Старая версия:</strong>{' '}
              <span style={{ fontFamily: 'monospace', color: '#dc3545' }}>
                {compareData.oldCommit?.sha?.substring(0, 7) || 'N/A'}
              </span>
              <div style={{ fontSize: '12px', color: '#666' }}>
                {compareData.oldCommit?.commit?.message?.substring(0, 50) || 'N/A'}...
              </div>
            </div>
            <div>
              <strong>Новая версия:</strong>{' '}
              <span style={{ fontFamily: 'monospace', color: '#28a745' }}>
                {compareData.newCommit?.sha?.substring(0, 7) || 'N/A'}
              </span>
              <div style={{ fontSize: '12px', color: '#666' }}>
                {compareData.newCommit?.commit?.message?.substring(0, 50) || 'N/A'}...
              </div>
            </div>
          </div>

          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '20px'
          }}>
            {differences.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '40px',
                color: '#28a745'
              }}>
                <h4>✓ Изменений не найдено</h4>
                <p>Схемы идентичны</p>
              </div>
            ) : (
              <div>
                <h4 style={{ marginBottom: '15px' }}>
                  Найдено изменений: {differences.length}
                </h4>
                
                {differences.filter(d => d.type === 'added').length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <h5 style={{ color: '#28a745', marginBottom: '10px' }}>
                      ➕ Добавленные блоки ({differences.filter(d => d.type === 'added').length})
                    </h5>
                    {differences.filter(d => d.type === 'added').map((diff, idx) => (
                      <div 
                        key={idx}
                        style={{
                          padding: '10px',
                          backgroundColor: '#d4edda',
                          border: '1px solid #c3e6cb',
                          borderRadius: '4px',
                          marginBottom: '8px',
                          fontFamily: 'monospace',
                          fontSize: '12px'
                        }}
                      >
                        {diff.blockId} - {diff.block?.Title || 'Без названия'}
                      </div>
                    ))}
                  </div>
                )}

                {differences.filter(d => d.type === 'removed').length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <h5 style={{ color: '#dc3545', marginBottom: '10px' }}>
                      ➖ Удалённые блоки ({differences.filter(d => d.type === 'removed').length})
                    </h5>
                    {differences.filter(d => d.type === 'removed').map((diff, idx) => (
                      <div 
                        key={idx}
                        style={{
                          padding: '10px',
                          backgroundColor: '#f8d7da',
                          border: '1px solid #f5c6cb',
                          borderRadius: '4px',
                          marginBottom: '8px',
                          fontFamily: 'monospace',
                          fontSize: '12px'
                        }}
                      >
                        {diff.blockId} - {diff.block?.Title || 'Без названия'}
                      </div>
                    ))}
                  </div>
                )}

                {differences.filter(d => d.type === 'modified').length > 0 && (
                  <div>
                    <h5 style={{ color: '#ffc107', marginBottom: '10px' }}>
                      ✏️ Изменённые свойства ({differences.filter(d => d.type === 'modified').length})
                    </h5>
                    {differences.filter(d => d.type === 'modified').map((diff, idx) => (
                      <div 
                        key={idx}
                        style={{
                          padding: '10px',
                          backgroundColor: '#fff3cd',
                          border: '1px solid #ffeeba',
                          borderRadius: '4px',
                          marginBottom: '8px',
                          fontSize: '12px'
                        }}
                      >
                        <div style={{ marginBottom: '5px' }}>
                          <strong>Блок:</strong> {diff.blockId}
                        </div>
                        <div style={{ display: 'flex', gap: '20px' }}>
                          <div>
                            <strong style={{ color: '#dc3545' }}>{diff.property}:</strong>
                            <div style={{ fontFamily: 'monospace', color: '#dc3545' }}>
                              {String(diff.oldValue).substring(0, 50)}...
                            </div>
                          </div>
                          <div>
                            <strong style={{ color: '#28a745' }}>→</strong>
                            <div style={{ fontFamily: 'monospace', color: '#28a745' }}>
                              {String(diff.newValue).substring(0, 50)}...
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
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
          {compareData && (
            <span style={{ marginLeft: '15px', fontSize: '13px', color: '#6f42c1' }}>
              🔍 Доступно сравнение
            </span>
          )}
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
          {compareData && (
            <button 
              onClick={() => setShowCompareView(true)}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6f42c1',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#5a32a3'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#6f42c1'}
            >
              🔍 Показать сравнение
            </button>
          )}
          <button 
            onClick={() => {
              setAreas([{ id: 1, title: 'Схема 1', active: true }]);
              setActiveAreaId(1);
              setCompareData(null);
              setShowCompareView(false);
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
              onCompare={handleCompare}
              sharedGitConfig={sharedGitConfig}
              setSharedGitConfig={setSharedGitConfig}
              sharedGitFiles={sharedGitFiles}
              setSharedGitFiles={setSharedGitFiles}
              sharedSelectedGitFile={sharedSelectedGitFile}
              setSharedSelectedGitFile={setSharedSelectedGitFile}
              sharedGitCommits={sharedGitCommits}
              setSharedGitCommits={setSharedGitCommits}
            />
          </div>
        ))}
      </div>

      {showCompareView && <CompareView />}

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