import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background lg:h-screen lg:overflow-hidden">
      <main className="min-w-0 lg:h-screen">
        <div className="flex h-14 items-center justify-between gap-4 border-b px-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-7 w-24" />
          </div>
          <Skeleton className="h-9 w-full max-w-3xl" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_190px]">
              <Card className="min-h-0 rounded-lg lg:h-full">
                <CardHeader className="border-b py-3">
                  <Skeleton className="h-5 w-36" />
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-3">
                  {Array.from({ length: 15 }).map((_, index) => (
                    <Skeleton key={index} className="h-7 w-full" />
                  ))}
                </CardContent>
              </Card>
              <div className="grid min-h-0 gap-3 overflow-hidden lg:h-full lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Card key={index} size="sm" className="h-48 gap-0 rounded-lg py-0 lg:h-full">
                    <CardHeader className="border-b px-3 py-1 [.border-b]:pb-1">
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-3 py-1">
                      {Array.from({ length: 4 }).map((_, rowIndex) => (
                        <Skeleton key={rowIndex} className="h-6 w-full" />
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <div className="hidden min-h-0 flex-col gap-3 lg:flex">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card key={index} size="sm" className="rounded-lg">
                  <CardHeader className="border-b py-3">
                    <Skeleton className="h-4 w-36" />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-5/6" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
