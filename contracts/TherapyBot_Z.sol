pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TherapyBotAdapter is ZamaEthereumConfig {
    
    struct Session {
        address patient;
        euint32 encryptedMessage;
        uint256 timestamp;
        uint32 decryptedResponse;
        bool isProcessed;
    }
    
    mapping(uint256 => Session) public sessions;
    uint256 public sessionCount = 0;
    
    event SessionCreated(uint256 indexed sessionId, address indexed patient);
    event ResponseDecrypted(uint256 indexed sessionId, uint32 decryptedResponse);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createSession(
        externalEuint32 encryptedMessage,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedMessage, inputProof)), "Invalid encrypted input");
        
        uint256 sessionId = sessionCount++;
        sessions[sessionId] = Session({
            patient: msg.sender,
            encryptedMessage: FHE.fromExternal(encryptedMessage, inputProof),
            timestamp: block.timestamp,
            decryptedResponse: 0,
            isProcessed: false
        });
        
        FHE.allowThis(sessions[sessionId].encryptedMessage);
        FHE.makePubliclyDecryptable(sessions[sessionId].encryptedMessage);
        
        emit SessionCreated(sessionId, msg.sender);
    }
    
    function processSession(
        uint256 sessionId,
        bytes memory abiEncodedClearResponse,
        bytes memory decryptionProof
    ) external {
        require(sessionId < sessionCount, "Invalid session ID");
        require(!sessions[sessionId].isProcessed, "Session already processed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sessions[sessionId].encryptedMessage);
        
        FHE.checkSignatures(cts, abiEncodedClearResponse, decryptionProof);
        
        uint32 decodedResponse = abi.decode(abiEncodedClearResponse, (uint32));
        
        sessions[sessionId].decryptedResponse = decodedResponse;
        sessions[sessionId].isProcessed = true;
        
        emit ResponseDecrypted(sessionId, decodedResponse);
    }
    
    function getEncryptedMessage(uint256 sessionId) external view returns (euint32) {
        require(sessionId < sessionCount, "Invalid session ID");
        return sessions[sessionId].encryptedMessage;
    }
    
    function getSessionData(uint256 sessionId) external view returns (
        address patient,
        uint256 timestamp,
        bool isProcessed,
        uint32 decryptedResponse
    ) {
        require(sessionId < sessionCount, "Invalid session ID");
        Session storage session = sessions[sessionId];
        
        return (
            session.patient,
            session.timestamp,
            session.isProcessed,
            session.decryptedResponse
        );
    }
    
    function getTotalSessions() external view returns (uint256) {
        return sessionCount;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


