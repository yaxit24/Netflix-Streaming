const { ipcRenderer } = require('electron');

const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let peerConnection;
let localStream;

// HTML Elements
const createOfferBtn = document.getElementById('createOfferBtn');
const localOfferText = document.getElementById('localOfferText');
const remoteAnswerText = document.getElementById('remoteAnswerText');
const acceptAnswerBtn = document.getElementById('acceptAnswerBtn');

const remoteOfferText = document.getElementById('remoteOfferText');
const createAnswerBtn = document.getElementById('createAnswerBtn');
const localAnswerText = document.getElementById('localAnswerText');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Create a new RTCPeerConnection and map the remote video track when it arrives
function setupPeerConnection() {
    const pc = new RTCPeerConnection(config);
    
    // Listen for remote tracks (Viewer side)
    pc.ontrack = (event) => {
        console.log("Received remote track from Host");
        remoteVideo.srcObject = event.streams[0];
    };
    
    return pc;
}

// ---------------------------------------------------------------- //
// HOST LOGIC (Sender)
// ---------------------------------------------------------------- //
createOfferBtn.onclick = async () => {
    // 1. Get Screen Capture Sources from Electron Main Process
    let sources;
    try {
        sources = await ipcRenderer.invoke('get-sources');
    } catch (err) {
        alert("Failed to get desktop sources: " + err);
        return;
    }
    
    // Choose the primary entire desktop payload (Usually 'Screen 1')
    const source = sources.find(s => s.id.startsWith('screen')) || sources[0]; 

    // 2. Capture the screen via WebRTC MediaDevices API
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: false, // capturing system audio programmatically on macOS from Electron requires complex loopback extensions. Video only.
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: source.id,
                    minWidth: 1280,
                    maxWidth: 1920,
                    minHeight: 720,
                    maxHeight: 1080
                }
            }
        });
        localVideo.srcObject = localStream;
    } catch (e) {
        alert("Screen capture rejected or failed. Are screen recording permissions granted?");
        console.error(e);
        return;
    }

    // 3. Setup Peer Connection and add tracks
    peerConnection = setupPeerConnection();
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // 4. Create Offer & Gather ICE Candidates
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    localOfferText.value = "Gathering network candidates, please wait...";

    // Wait for ICE gathering to complete before displaying full offer
    peerConnection.onicegatheringstatechange = () => {
        if (peerConnection.iceGatheringState === 'complete') {
            const offerPayload = btoa(JSON.stringify(peerConnection.localDescription));
            localOfferText.value = offerPayload;
            
            // Auto copy to clipboard
            navigator.clipboard.writeText(offerPayload);
            alert("Offer code generated and copied to your clipboard!\n\nSend this huge text string to the Viewer.");
        }
    };
};

acceptAnswerBtn.onclick = async () => {
    const answerStr = remoteAnswerText.value.trim();
    if (!answerStr) return alert("Please paste the Answer code first.");
    
    try {
        const answer = JSON.parse(atob(answerStr));
        await peerConnection.setRemoteDescription(answer);
        console.log("Successfully connected to viewer!");
        alert("Connection established! You are now streaming P2P directly to the viewer.");
    } catch (e) {
        alert("Invalid Answer JSON format. Ensure you pasted the exact string.");
    }
};

// ---------------------------------------------------------------- //
// VIEWER LOGIC (Receiver)
// ---------------------------------------------------------------- //
createAnswerBtn.onclick = async () => {
    const offerStr = remoteOfferText.value.trim();
    if (!offerStr) return alert("Please paste the Host's Offer code first.");
    
    peerConnection = setupPeerConnection();

    try {
        const offer = JSON.parse(atob(offerStr));
        await peerConnection.setRemoteDescription(offer);
        
        // Generate Answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        localAnswerText.value = "Gathering network candidates, please wait...";

        // Wait for ICE gathering to complete before displaying full answer
        peerConnection.onicegatheringstatechange = () => {
            if (peerConnection.iceGatheringState === 'complete') {
                const answerPayload = btoa(JSON.stringify(peerConnection.localDescription));
                localAnswerText.value = answerPayload;
                
                // Auto copy
                navigator.clipboard.writeText(answerPayload);
                alert("Answer code generated and copied to your clipboard!\n\nSend this back to the Host.");
            }
        };

    } catch (e) {
        alert("Invalid Offer JSON format. Ensure you pasted the exact string produced by the Host.");
        console.error(e);
    }
};
