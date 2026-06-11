import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background lg:h-screen lg:overflow-hidden">
      <main className="min-w-0 lg:h-screen">
        <div className="flex min-h-14 flex-col gap-2 border-b px-2 py-2 sm:px-3 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-7 w-24" />
            <div className="hidden items-center gap-1 xl:flex">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center lg:max-w-[820px] xl:max-w-none">
            <Skeleton className="h-8 min-w-0 flex-1 rounded-lg md:min-w-48" />
            <div className="flex w-full flex-wrap gap-2 md:w-auto md:flex-nowrap">
              <Skeleton className="h-8 min-w-32 flex-1 rounded-lg sm:flex-none md:w-32" />
              <Skeleton className="h-8 min-w-36 flex-1 rounded-lg sm:flex-none md:w-36" />
              <Skeleton className="h-8 min-w-24 flex-1 rounded-lg sm:flex-none md:w-24" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
        <div className="flex min-h-0 flex-col gap-3 p-3 lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,1fr)_190px]">
              <Card className="min-h-0 gap-0 rounded-lg py-0 lg:h-full">
                <CardHeader className="min-h-10 border-b px-3 py-1.5 [.border-b]:pb-1.5">
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
                    <CardHeader className="min-h-9 border-b px-3 py-1.5 [.border-b]:pb-1.5">
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-2 py-1.5">
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
                <Card key={index} size="sm" className="gap-0 rounded-lg py-0">
                  <CardHeader className="min-h-10 border-b px-3 py-2 [.border-b]:pb-2">
                    <Skeleton className="h-4 w-36" />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 px-3 py-2">
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
