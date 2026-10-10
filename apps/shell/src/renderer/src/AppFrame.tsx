import { useEffect, useState } from 'react'
import { Workspace } from './infomonk/Workspace'
import { TabBar } from './TabBar'

export function AppFrame() {
  const [homeActive, setHomeActive] = useState(true)
  const [activeFile, setActiveFile] = useState<string | undefined>()
  useEffect(() => {
    const applyTabs = (tabs: Awaited<ReturnType<typeof window.aiOfficeTabs.list>>) => {
      const active = tabs.find((tab) => tab.active)
      setHomeActive(!active || active.kind === 'home')
      setActiveFile(active?.filePath)
    }
    void window.aiOfficeTabs.list().then(applyTabs)
    return window.aiOfficeTabs.onChanged(applyTabs)
  }, [])
  return (
    <div className="app-frame">
      <TabBar />
      <div className="app-frame-content">
        <Workspace homeActive={homeActive} {...(activeFile ? { activeFile } : {})} />
      </div>
    </div>
  )
}
