import { BrowserRouter, Routes, Route } from 'react-router-dom';
import BusinessSelector from './components/BusinessSelector';
import ChatPage from './pages/ChatPage';

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<BusinessSelector />} />
      <Route path="/chat/:chatUuid" element={<ChatPage />} />
    </Routes>
  </BrowserRouter>
);

export default App;
