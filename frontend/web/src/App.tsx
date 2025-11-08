import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TherapySession {
  id: string;
  title: string;
  moodScore: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface CBTResponse {
  question: string;
  thought: string;
  reframe: string;
  action: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<TherapySession[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newSessionData, setNewSessionData] = useState({ 
    title: "", 
    mood: "", 
    thought: "" 
  });
  const [selectedSession, setSelectedSession] = useState<TherapySession | null>(null);
  const [decryptedMood, setDecryptedMood] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [faqOpen, setFaqOpen] = useState(false);
  const [stats, setStats] = useState({
    totalSessions: 0,
    avgMood: 0,
    verifiedSessions: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const faqItems = [
    { question: "我的对话数据安全吗？", answer: "所有对话内容都经过FHE同态加密，只有您能解密查看原始数据。" },
    { question: "如何开始治疗会话？", answer: "点击'新建治疗会话'按钮，输入您的情绪和想法，系统会自动生成CBT引导。" },
    { question: "加密的数据能恢复吗？", answer: "是的，通过您的钱包私钥可以随时解密已加密的治疗数据。" }
  ];

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const sessionsList: TherapySession[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          sessionsList.push({
            id: businessId,
            title: businessData.name,
            moodScore: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading session data:', e);
        }
      }
      
      setSessions(sessionsList);
      updateStats(sessionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (sessionList: TherapySession[]) => {
    const total = sessionList.length;
    const verified = sessionList.filter(s => s.isVerified).length;
    const avg = total > 0 ? sessionList.reduce((sum, s) => sum + s.moodScore, 0) / total : 0;
    
    setStats({
      totalSessions: total,
      avgMood: Number(avg.toFixed(1)),
      verifiedSessions: verified
    });
  };

  const createSession = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSession(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建加密治疗会话中..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const moodValue = parseInt(newSessionData.mood) || 1;
      const businessId = `therapy-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, moodValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSessionData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        moodValue,
        0,
        newSessionData.thought
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "治疗会话创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSessionData({ title: "", mood: "", thought: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSession(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecryptSession = async (session: TherapySession) => {
    const decrypted = await decryptData(session.id);
    if (decrypted !== null) {
      setDecryptedMood(decrypted);
    }
  };

  const filteredSessions = sessions.filter(session =>
    session.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    session.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const generateCBTResponse = (mood: number, thought: string): CBTResponse => {
    const questions = [
      "这个想法有证据支持吗？",
      "有没有其他解释的可能性？",
      "最坏的情况发生的概率有多大？",
      "这个想法对你有帮助吗？"
    ];
    
    const reframes = [
      "也许情况没有想象的那么糟糕",
      "我可以尝试从不同角度看待这个问题",
      "这只是一个想法，不一定是事实",
      "我有能力应对这个挑战"
    ];
    
    const actions = [
      "尝试深呼吸放松",
      "写下三个感恩的事情",
      "与信任的人交流",
      "进行10分钟的身体活动"
    ];
    
    return {
      question: questions[mood % questions.length],
      thought: `我注意到你在想: "${thought}"`,
      reframe: reframes[mood % reframes.length],
      action: actions[mood % actions.length]
    };
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const available = await contract.isAvailable();
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "FHE服务可用性检查成功" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "服务检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>💬 隐私心理Bot</h1>
            <span className="subtitle">FHE加密认知行为疗法</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始加密治疗</h2>
            <p>保护您的隐私，享受安全的AI心理辅导体验</p>
            <div className="therapy-features">
              <div className="feature">
                <span>🔒</span>
                <p>端到端加密对话</p>
              </div>
              <div className="feature">
                <span>🧠</span>
                <p>CBT认知行为疗法</p>
              </div>
              <div className="feature">
                <span>⚡</span>
                <p>随时可用</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="therapy-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">正在准备安全的治疗环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="therapy-spinner"></div>
      <p>加载加密治疗系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>💬 隐私心理Bot</h1>
          <span className="subtitle">FHE加密认知行为疗法</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            🔍 检查服务
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新建治疗会话
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-info">
              <h3>总会话数</h3>
              <span className="stat-value">{stats.totalSessions}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">😊</div>
            <div className="stat-info">
              <h3>平均情绪分</h3>
              <span className="stat-value">{stats.avgMood}/10</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-info">
              <h3>已验证会话</h3>
              <span className="stat-value">{stats.verifiedSessions}</span>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="搜索会话标题或创建者..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>
          <button 
            onClick={loadData} 
            className="refresh-btn" 
            disabled={isRefreshing}
          >
            {isRefreshing ? "刷新中..." : "🔄 刷新"}
          </button>
        </div>

        <div className="sessions-section">
          <h2>治疗会话记录</h2>
          <div className="sessions-grid">
            {filteredSessions.length === 0 ? (
              <div className="no-sessions">
                <p>暂无治疗会话记录</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  创建第一个会话
                </button>
              </div>
            ) : filteredSessions.map((session, index) => (
              <div 
                className={`session-card ${selectedSession?.id === session.id ? "selected" : ""} ${session.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedSession(session)}
              >
                <div className="session-header">
                  <h3>{session.title}</h3>
                  <span className={`status-badge ${session.isVerified ? "verified" : "pending"}`}>
                    {session.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  </span>
                </div>
                <div className="session-meta">
                  <span>情绪分数: {session.moodScore}/10</span>
                  <span>{new Date(session.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="session-creator">
                  创建者: {session.creator.substring(0, 6)}...{session.creator.substring(38)}
                </div>
                <button 
                  className="decrypt-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDecryptSession(session);
                  }}
                  disabled={isDecrypting}
                >
                  {session.isVerified ? "✅ 已解密" : "🔓 解密验证"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="faq-section">
          <div className="faq-header" onClick={() => setFaqOpen(!faqOpen)}>
            <h2>常见问题解答</h2>
            <span className={`faq-toggle ${faqOpen ? "open" : ""}`}>▼</span>
          </div>
          {faqOpen && (
            <div className="faq-content">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <h4>❓ {item.question}</h4>
                  <p>💡 {item.answer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateSession 
          onSubmit={createSession} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSession} 
          sessionData={newSessionData} 
          setSessionData={setNewSessionData}
          isEncrypting={isEncrypting}
          generateCBTResponse={generateCBTResponse}
        />
      )}
      
      {selectedSession && (
        <SessionDetailModal 
          session={selectedSession} 
          onClose={() => { 
            setSelectedSession(null); 
            setDecryptedMood(null); 
          }} 
          decryptedMood={decryptedMood}
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSession.id)}
          generateCBTResponse={generateCBTResponse}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="therapy-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateSession: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  sessionData: any;
  setSessionData: (data: any) => void;
  isEncrypting: boolean;
  generateCBTResponse: (mood: number, thought: string) => CBTResponse;
}> = ({ onSubmit, onClose, creating, sessionData, setSessionData, isEncrypting, generateCBTResponse }) => {
  const [cbtPreview, setCbtPreview] = useState<CBTResponse | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSessionData({ ...sessionData, [name]: value });
    
    if (name === 'mood' || name === 'thought') {
      const mood = parseInt(sessionData.mood) || 5;
      const thought = name === 'thought' ? value : sessionData.thought;
      if (mood && thought) {
        setCbtPreview(generateCBTResponse(mood, thought));
      }
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-session-modal">
        <div className="modal-header">
          <h2>新建治疗会话</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE同态加密</strong>
            <p>情绪分数将使用Zama FHE进行加密保护</p>
          </div>
          
          <div className="form-group">
            <label>会话标题 *</label>
            <input 
              type="text" 
              name="title" 
              value={sessionData.title} 
              onChange={handleChange} 
              placeholder="例如：工作压力应对" 
            />
          </div>
          
          <div className="form-group">
            <label>当前情绪分数 (1-10) *</label>
            <input 
              type="number" 
              name="mood" 
              min="1" 
              max="10" 
              value={sessionData.mood} 
              onChange={handleChange} 
              placeholder="1-10分，10分为最佳" 
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>当前想法 *</label>
            <textarea 
              name="thought" 
              value={sessionData.thought} 
              onChange={handleChange} 
              placeholder="描述您现在的想法和感受..." 
              rows={3}
            />
            <div className="data-type-label">公开文本</div>
          </div>

          {cbtPreview && (
            <div className="cbt-preview">
              <h4>CBT引导预览：</h4>
              <p><strong>认知探索:</strong> {cbtPreview.question}</p>
              <p><strong>想法重构:</strong> {cbtPreview.reframe}</p>
              <p><strong>行动建议:</strong> {cbtPreview.action}</p>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !sessionData.title || !sessionData.mood || !sessionData.thought} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建会话"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SessionDetailModal: React.FC<{
  session: TherapySession;
  onClose: () => void;
  decryptedMood: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  generateCBTResponse: (mood: number, thought: string) => CBTResponse;
}> = ({ session, onClose, decryptedMood, isDecrypting, decryptData, generateCBTResponse }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  const cbtResponse = generateCBTResponse(
    session.isVerified ? (session.decryptedValue || session.moodScore) : (decryptedMood || session.moodScore),
    "用户的想法记录"
  );

  return (
    <div className="modal-overlay">
      <div className="session-detail-modal">
        <div className="modal-header">
          <h2>治疗会话详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="session-info">
            <div className="info-item">
              <span>会话标题:</span>
              <strong>{session.title}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{session.creator.substring(0, 6)}...{session.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(session.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>🔐 加密情绪数据</h3>
            
            <div className="data-row">
              <div className="data-label">情绪分数:</div>
              <div className="data-value">
                {session.isVerified ? 
                  `${session.decryptedValue} (链上已验证)` : 
                  decryptedMood !== null ? 
                  `${decryptedMood} (本地已解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn ${(session.isVerified || decryptedMood !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : session.isVerified ? (
                  "✅ 已验证"
                ) : decryptedMood !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE同态加密保护</strong>
                <p>您的情绪数据在链上加密存储，只有您能解密查看真实数值</p>
              </div>
            </div>
          </div>
          
          <div className="cbt-section">
            <h3>🧠 CBT认知行为疗法引导</h3>
            <div className="cbt-steps">
              <div className="cbt-step">
                <span className="step-number">1</span>
                <div className="step-content">
                  <strong>认知探索:</strong>
                  <p>{cbtResponse.question}</p>
                </div>
              </div>
              <div className="cbt-step">
                <span className="step-number">2</span>
                <div className="step-content">
                  <strong>想法重构:</strong>
                  <p>{cbtResponse.reframe}</p>
                </div>
              </div>
              <div className="cbt-step">
                <span className="step-number">3</span>
                <div className="step-content">
                  <strong>行动建议:</strong>
                  <p>{cbtResponse.action}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!session.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


